import { createHash } from "node:crypto";
import mongoose, { type ClientSession } from "mongoose";
import { withTransaction } from "../../db";
import { CancelledLead } from "../../models/CancelledLead";
import {
  getGranotBookingDiscrepancyModel,
  type GranotBookingDiscrepancyDocument,
} from "../../models/GranotBookingDiscrepancy";
import {
  getGranotReleaseDiscrepancyModel,
  type GranotReleaseDiscrepancyDocument,
} from "../../models/GranotReleaseDiscrepancy";
import type {
  GranotDiscrepancyDocument,
  GranotDiscrepancyEvidence,
} from "../../models/granotDiscrepancyModel";
import { getGranotObservationReceiptModel } from "../../models/GranotObservationReceipt";
import type {
  SynchronizationDecisionDocument,
  SynchronizationDecisionSourceScope,
} from "../../models/SynchronizationDecision";
import { getSynchronizationDecisionModel } from "../../models/SynchronizationDecision";
import { toObjectId } from "../../utils/objectId";
import { emitGranotLifecycleEvent } from "./observability";
import { canonicalJson } from "../durableWork/checksum";
import {
  classifyBookingReconciliation,
  createMongoBookingReconciliationStore,
} from "./bookingReconciliation";
import {
  classifyReleaseReconciliation,
  createMongoReleaseReconciliationStore,
} from "./releaseReconciliation";
import type { EvaluatedGate } from "./sourcePolicy";
import type {
  EntityRef,
  ExecutionMode,
  GranotDiscrepancyReasonCode,
  LeadModel,
  SynchronizationOutcome,
  SynchronizationReasonCode,
} from "./types";

export type DiscrepancyFingerprintInput = {
  discrepancy_kind: "booking" | "release";
  normalized_job_no: string;
  reason_code: GranotDiscrepancyReasonCode;
  record_link_id?: string | null;
  lead_ref?: { model: LeadModel; id: string } | null;
  booking_id?: string | null;
  cancellation_id?: string | null;
};

export function createDiscrepancyFingerprint(
  input: DiscrepancyFingerprintInput,
): string {
  const identity = {
    version: 1,
    discrepancy_kind: input.discrepancy_kind,
    normalized_job_no: input.normalized_job_no,
    reason_code: input.reason_code,
    record_link_id: input.record_link_id?.toLowerCase() ?? null,
    lead_ref: input.lead_ref
      ? {
          model: input.lead_ref.model,
          id: input.lead_ref.id.toLowerCase(),
        }
      : null,
    booking_id: input.booking_id?.toLowerCase() ?? null,
    cancellation_id: input.cancellation_id?.toLowerCase() ?? null,
  };
  return createHash("sha256")
    .update(canonicalJson(identity), "utf8")
    .digest("hex");
}

export type DiscrepancyCurrentContext = {
  observation_id: string;
  receipt_id: string;
  normalized_job_no: string;
  captured_at: Date;
  action: "priority_5" | "booked" | "release";
  classified_reason_code?: GranotDiscrepancyReasonCode;
  record_link_id?: string;
  lead_ref?: { model: LeadModel; id: string };
  booking_id?: string;
  cancellation_id?: string;
};

export type PreparedDiscrepancyDecision = {
  receipt_id: mongoose.Types.ObjectId;
  observation_id: mongoose.Types.ObjectId;
  attempt: number;
  execution_mode: ExecutionMode;
  outcome: SynchronizationOutcome;
  reason_code: SynchronizationReasonCode;
  match_method?: SynchronizationDecisionDocument["match_method"];
  source_scope?: SynchronizationDecisionSourceScope;
  candidates: SynchronizationDecisionDocument["candidates"];
  evaluated_gates: EvaluatedGate[];
  effects: SynchronizationDecisionDocument["effects"];
  decided_at: Date;
};

export type DiscrepancyEffectResult = {
  kind: "opened" | "refreshed";
  discrepancy_ref: EntityRef & {
    model: "GranotBookingDiscrepancy" | "GranotReleaseDiscrepancy";
  };
  reason_code:
    | "booking_discrepancy_opened"
    | "booking_discrepancy_refreshed"
    | "release_discrepancy_opened"
    | "release_discrepancy_refreshed";
  revision: number;
  evidence_revision: number;
};

export interface DiscrepancyPersistenceStore {
  withTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T>;
  loadCurrentContext(
    kind: "booking" | "release",
    observationId: string,
    session: ClientSession,
  ): Promise<DiscrepancyCurrentContext>;
  findOpen(
    kind: "booking" | "release",
    fingerprint: string,
    session: ClientSession,
  ): Promise<GranotDiscrepancyDocument | null>;
  insert(
    kind: "booking" | "release",
    row: GranotDiscrepancyDocument,
    session: ClientSession,
  ): Promise<GranotDiscrepancyDocument>;
  refresh(
    kind: "booking" | "release",
    input: {
      discrepancy_id: mongoose.Types.ObjectId;
      evidence: GranotDiscrepancyEvidence;
    },
    session: ClientSession,
  ): Promise<GranotDiscrepancyDocument>;
  insertDecision(
    decision: SynchronizationDecisionDocument,
    receiptId: mongoose.Types.ObjectId,
    session: ClientSession,
  ): Promise<void>;
}

export interface GranotDiscrepancies {
  reconcileObservation(input: {
    discrepancy_kind: "booking" | "release";
    reason_code: GranotDiscrepancyReasonCode;
    observation_id: string;
    decision_id: string;
  }): Promise<DiscrepancyEffectResult>;
}

export function createGranotDiscrepancies(input: {
  prepared: PreparedDiscrepancyDecision;
  store?: DiscrepancyPersistenceStore;
}): GranotDiscrepancies {
  return {
    reconcileObservation: (request) =>
      reconcileDiscrepancy(
        request,
        input.prepared,
        input.store ?? createMongoDiscrepancyStore(),
      ),
  };
}

async function reconcileDiscrepancy(
  input: {
    discrepancy_kind: "booking" | "release";
    reason_code: GranotDiscrepancyReasonCode;
    observation_id: string;
    decision_id: string;
  },
  prepared: PreparedDiscrepancyDecision,
  store: DiscrepancyPersistenceStore,
): Promise<DiscrepancyEffectResult> {
  if (
    prepared.execution_mode !== "live" ||
    String(prepared.observation_id) !== input.observation_id ||
    !prepared.evaluated_gates.every((gate) => gate.allowed)
  ) {
    throw new Error("Discrepancy persistence requires current live evidence and allowed gates.");
  }
  let result: DiscrepancyEffectResult | undefined;
  for (let raceAttempt = 0; raceAttempt < 2; raceAttempt += 1) {
    try {
      result = await store.withTransaction(async (session) => {
        const current = await store.loadCurrentContext(
          input.discrepancy_kind,
          input.observation_id,
          session,
        );
        if (
          current.observation_id !== input.observation_id ||
          current.receipt_id !== String(prepared.receipt_id) ||
          current.classified_reason_code !== input.reason_code
        ) {
          throw new Error("Discrepancy classification changed before persistence.");
        }
        const fingerprint = createDiscrepancyFingerprint({
          discrepancy_kind: input.discrepancy_kind,
          normalized_job_no: current.normalized_job_no,
          reason_code: input.reason_code,
          record_link_id: current.record_link_id,
          lead_ref: current.lead_ref,
          booking_id: current.booking_id,
          cancellation_id: current.cancellation_id,
        });
        const evidence: GranotDiscrepancyEvidence = {
          observation_id: prepared.observation_id,
          decision_id: toObjectId(input.decision_id),
          captured_at: current.captured_at,
          action: current.action,
        };
        const existing = await store.findOpen(
          input.discrepancy_kind,
          fingerprint,
          session,
        );
        let row: GranotDiscrepancyDocument;
        let effect: "opened" | "refreshed";
        if (existing) {
          row = existing.evidence.some(
            (item) => String(item.observation_id) === input.observation_id,
          )
            ? existing
            : await store.refresh(
                input.discrepancy_kind,
                { discrepancy_id: existing._id, evidence },
                session,
              );
          effect = "refreshed";
        } else {
          row = await store.insert(
            input.discrepancy_kind,
            {
              _id: new mongoose.Types.ObjectId(),
              normalized_job_no: current.normalized_job_no,
              discrepancy_kind: input.discrepancy_kind,
              reason_code: input.reason_code,
              reason_fingerprint: fingerprint,
              state: "open",
              ...(current.record_link_id
                ? { record_link_id: toObjectId(current.record_link_id) }
                : {}),
              ...(current.lead_ref
                ? {
                    lead_ref: {
                      model: current.lead_ref.model,
                      id: toObjectId(current.lead_ref.id),
                    },
                  }
                : {}),
              ...(current.booking_id
                ? { booking_id: toObjectId(current.booking_id) }
                : {}),
              ...(current.cancellation_id
                ? { cancellation_id: toObjectId(current.cancellation_id) }
                : {}),
              evidence: [evidence],
              evidence_revision: 1,
              revision: 1,
              opened_at: prepared.decided_at,
              last_evidence_at: current.captured_at,
            },
            session,
          );
          effect = "opened";
        }
        const reasonCode = `${input.discrepancy_kind}_discrepancy_${effect}` as
          DiscrepancyEffectResult["reason_code"];
        const discrepancyRef = {
          model: input.discrepancy_kind === "booking"
            ? "GranotBookingDiscrepancy" as const
            : "GranotReleaseDiscrepancy" as const,
          id: String(row._id),
        };
        await store.insertDecision(
          {
            _id: toObjectId(input.decision_id),
            observation_id: prepared.observation_id,
            attempt: prepared.attempt,
            execution_mode: prepared.execution_mode,
            outcome: "conflict",
            reason_code: reasonCode,
            match_method: prepared.match_method,
            source_scope: prepared.source_scope,
            candidates: prepared.candidates,
            evaluated_gates: prepared.evaluated_gates,
            target: discrepancyRef,
            effects: [
              {
                kind: effect === "opened"
                  ? "discrepancy_opened"
                  : "discrepancy_refreshed",
                ref: discrepancyRef,
              },
            ],
            decided_at: prepared.decided_at,
          },
          prepared.receipt_id,
          session,
        );
        return {
          kind: effect,
          discrepancy_ref: discrepancyRef,
          reason_code: reasonCode,
          revision: row.revision,
          evidence_revision: row.evidence_revision,
        };
      });
      break;
    } catch (error) {
      if (raceAttempt === 1 || !isRetryableDiscrepancyRace(error)) throw error;
    }
  }
  if (!result) throw new Error("Discrepancy reconciliation produced no result.");
  await emitGranotLifecycleEvent({
    eventKey: `granot_lifecycle.${result.reason_code}`,
    category: "admin",
    workflow: "granot_discrepancy",
    summary: result.kind === "opened"
      ? "Granot discrepancy opened"
      : "Granot discrepancy refreshed",
    details: {
      discrepancy_id: result.discrepancy_ref.id,
      observation_id: input.observation_id,
      decision_id: input.decision_id,
      kind: input.discrepancy_kind,
      reason_code: input.reason_code,
      revision: result.revision,
      evidence_revision: result.evidence_revision,
    },
    piiPolicy: "masked",
  });
  return result;
}

export function createMongoDiscrepancyStore(): DiscrepancyPersistenceStore {
  return {
    withTransaction,
    async loadCurrentContext(kind, observationId, session) {
      if (kind === "booking") {
        const current = await createMongoBookingReconciliationStore()
          .loadCurrentContext(observationId, session);
        const classification = classifyBookingReconciliation(current);
        const target = current.identity.target;
        const cancellation = current.booking?.officially_cancelled && current.booking.id
          ? await CancelledLead.findOne({ booked_lead: toObjectId(current.booking.id) })
              .session(session)
              .select({ _id: 1 })
              .lean()
              .exec()
          : null;
        return {
          observation_id: current.observation_id,
          receipt_id: current.receipt_id,
          normalized_job_no: current.normalized_job_no ?? "",
          captured_at: current.captured_at,
          action: current.booking_action === "booked" ? "booked" : "priority_5",
          classified_reason_code:
            classification.kind === "booking_discrepancy_required"
              ? classification.reason_code
              : undefined,
          record_link_id: current.record_link_id,
          lead_ref:
            target && (target.model === "FormLead" || target.model === "CallLead")
              ? { model: target.model, id: target.id }
              : undefined,
          booking_id: current.booking?.id,
          cancellation_id: cancellation ? String(cancellation._id) : undefined,
        };
      }
      const current = await createMongoReleaseReconciliationStore()
        .loadCurrentContext(observationId, session);
      const classification = classifyReleaseReconciliation(current);
      const target = current.identity.target;
      return {
        observation_id: current.observation_id,
        receipt_id: current.receipt_id,
        normalized_job_no: current.normalized_job_no ?? "",
        captured_at: current.captured_at,
        action: "release",
        classified_reason_code:
          classification.kind === "release_discrepancy_required"
            ? classification.reason_code
            : undefined,
        record_link_id: current.record_link_id,
        lead_ref:
          target && (target.model === "FormLead" || target.model === "CallLead")
            ? { model: target.model, id: target.id }
            : undefined,
        booking_id: current.booking?.id,
        cancellation_id: current.booking?.cancellation_id,
      };
    },
    async findOpen(kind, fingerprint, session) {
      return discrepancyModel(kind)
        .findOne({ state: "open", reason_fingerprint: fingerprint })
        .session(session)
        .lean()
        .exec() as Promise<GranotDiscrepancyDocument | null>;
    },
    async insert(kind, row, session) {
      const [created] = await discrepancyModel(kind).create([row], { session });
      if (!created) throw new Error("Discrepancy insert returned no row.");
      return created.toObject() as GranotDiscrepancyDocument;
    },
    async refresh(kind, input, session) {
      const updated = await discrepancyModel(kind)
        .findOneAndUpdate(
          {
            _id: input.discrepancy_id,
            state: "open",
            "evidence.observation_id": { $ne: input.evidence.observation_id },
          },
          {
            $push: { evidence: input.evidence },
            $set: { last_evidence_at: input.evidence.captured_at },
            $inc: { evidence_revision: 1 },
          },
          { session, returnDocument: "after", runValidators: true },
        )
        .lean()
        .exec();
      if (updated) return updated as GranotDiscrepancyDocument;
      const replay = await discrepancyModel(kind)
        .findOne({ _id: input.discrepancy_id, state: "open" })
        .session(session)
        .lean()
        .exec();
      if (!replay) throw new Error("Resolved discrepancy cannot be refreshed.");
      return replay as GranotDiscrepancyDocument;
    },
    async insertDecision(decision, receiptId, session) {
      await getSynchronizationDecisionModel().create([decision], { session });
      await getGranotObservationReceiptModel().collection.updateOne(
        { _id: receiptId },
        { $set: { "processing.latest_decision_id": decision._id } },
        { session },
      );
    },
  };
}

function discrepancyModel(kind: "booking" | "release") {
  return kind === "booking"
    ? getGranotBookingDiscrepancyModel()
    : getGranotReleaseDiscrepancyModel();
}

function isRetryableDiscrepancyRace(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      (("code" in error && (error as { code?: unknown }).code === 11000) ||
        ("errorLabels" in error &&
          Array.isArray((error as { errorLabels?: unknown }).errorLabels) &&
          (error as { errorLabels: unknown[] }).errorLabels.includes(
            "TransientTransactionError",
          ))),
  );
}
