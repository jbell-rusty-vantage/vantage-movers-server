import { BookedLead } from "../../models/BookedLead";
import { CallLead } from "../../models/CallLead";
import { CancelledLead } from "../../models/CancelledLead";
import { FormLead } from "../../models/FormLead";
import { normalizeComparisonName } from "../bookings/bookingIdentity";
import { toFloridaTimestamp } from "../../utils/easternTime";
import { normalizePhoneNumberForMatch } from "../../utils/phone";
import {
  MATCH_CALIBRATION_VERSION,
  type BestRelocationApplicationPlan,
  type BestRelocationPlanAction,
} from "./applicationPlan";
import { BEST_RELOCATION_CUTOFF, BEST_RELOCATION_TIMEZONE } from "./sheets";

export type CanonicalLeadDoc = {
  id: string;
  name?: string;
  phone_number?: string;
  normalized_phone_number?: string;
  timestamp?: Date;
  ref_no?: string;
  lid?: string;
  normalized_lid?: string;
};

export type CanonicalBookingDoc = {
  id: string;
  normalized_job_no?: string;
};

export type CanonicalAdoptionStore = {
  findFormLeadsByIdentity(identities: string[]): Promise<CanonicalLeadDoc[]>;
  findFormLeadsByPhoneNameDate(input: {
    phone: string;
    name: string;
    timestamp: Date;
  }): Promise<CanonicalLeadDoc[]>;
  findCallLeadsByPhoneTimestamp(input: {
    phone: string;
    timestamp: Date;
  }): Promise<CanonicalLeadDoc[]>;
  findBookingsByJob(normalizedJobNo: string): Promise<CanonicalBookingDoc[]>;
  findCancellationsByBooking(
    bookingId: string,
  ): Promise<Array<{ id: string; booked_lead: string }>>;
};

export type FormLeadAdoptionDecision =
  | {
      classification: "adopt";
      method: "lid_or_ref" | "phone_name_date";
      refs: Array<{ model: "FormLead"; id: string }>;
    }
  | { classification: "create" }
  | {
      classification: "conflict";
      type: "ambiguous_lead_match";
      refs?: Array<{ model: "FormLead"; id: string }>;
    };

export async function decideFormLeadAdoption(input: {
  payload: Record<string, unknown>;
  store: CanonicalAdoptionStore;
}): Promise<FormLeadAdoptionDecision> {
  const identities = uniqueIdentities(input.payload);
  if (identities.length) {
    const byIdentity = await input.store.findFormLeadsByIdentity(identities);
    if (byIdentity.length === 1) {
      return {
        classification: "adopt",
        method: "lid_or_ref",
        refs: [{ model: "FormLead", id: byIdentity[0].id }],
      };
    }
    if (byIdentity.length > 1) {
      return {
        classification: "conflict",
        type: "ambiguous_lead_match",
        refs: byIdentity.map((doc) => ({ model: "FormLead" as const, id: doc.id })),
      };
    }
  }

  const phone = normalizePhoneNumberForMatch(stringValue(input.payload.phone_number));
  const name = normalizeComparisonName(stringValue(input.payload.name));
  const timestamp = parseTimestamp(input.payload.timestamp);
  if (!phone || !name || !timestamp) {
    return { classification: "create" };
  }

  const byContact = (await input.store.findFormLeadsByPhoneNameDate({
    phone,
    name,
    timestamp,
  })).filter((doc) => formPhoneNameDateMatches(doc, phone, name, timestamp));

  if (byContact.length === 1) {
    return {
      classification: "adopt",
      method: "phone_name_date",
      refs: [{ model: "FormLead", id: byContact[0].id }],
    };
  }
  if (byContact.length > 1) {
    return {
      classification: "conflict",
      type: "ambiguous_lead_match",
      refs: byContact.map((doc) => ({ model: "FormLead" as const, id: doc.id })),
    };
  }
  return { classification: "create" };
}

export async function applyCanonicalAdoptionPolicy(input: {
  plan: BestRelocationApplicationPlan;
  store?: CanonicalAdoptionStore;
}): Promise<BestRelocationApplicationPlan> {
  const store = input.store ?? createMongoCanonicalAdoptionStore();
  const adoptedIds = new Map<string, string>();
  const actions: BestRelocationPlanAction[] = [];

  for (const action of input.plan.actions) {
    if (
      action.command === "unchanged" ||
      action.command === "record_conflict" ||
      action.command === "adopt_existing" ||
      action.command === "update_source_owned_lead"
    ) {
      const existingId = action.adopted_entity_refs?.[0]?.id;
      if (existingId) adoptedIds.set(action.action_key, existingId);
      actions.push(action);
      continue;
    }

    if (action.command === "create_form_lead") {
      const decision = await decideFormLeadAdoption({
        payload: action.command_payload ?? {},
        store,
      });
      actions.push(remapLeadAction(action, decision));
      if (decision.classification === "adopt") {
        adoptedIds.set(action.action_key, decision.refs[0].id);
      }
      continue;
    }

    if (action.command === "create_call_lead") {
      const remapped = await adoptCallLead(action, store);
      actions.push(remapped);
      const adoptedId = remapped.adopted_entity_refs?.[0]?.id;
      if (adoptedId) adoptedIds.set(action.action_key, adoptedId);
      continue;
    }

    if (
      action.command === "create_booked_from_source" ||
      action.command === "create_leadless_booking"
    ) {
      const remapped = await adoptBooking(action, store);
      actions.push(remapped);
      const adoptedId = remapped.adopted_entity_refs?.[0]?.id;
      if (adoptedId) adoptedIds.set(action.action_key, adoptedId);
      continue;
    }

    if (action.command === "create_cancelled_lead") {
      const bookingId = action.depends_on
        .map((dependency) => adoptedIds.get(dependency))
        .find((id): id is string => Boolean(id));
      actions.push(await adoptCancellation(action, store, bookingId));
      continue;
    }

    actions.push(action);
  }

  return {
    ...input.plan,
    actions,
    counters: countClassifications(actions),
  };
}

export function createMongoCanonicalAdoptionStore(): CanonicalAdoptionStore {
  return {
    async findFormLeadsByIdentity(identities) {
      if (!identities.length) return [];
      const docs = await FormLead.find({
        source_company: "best_relocation_leads",
        $or: [
          { ref_no: { $in: identities } },
          { lid: { $in: identities } },
          { normalized_lid: { $in: identities.map((value) => value.toLowerCase()) } },
        ],
      })
        .select("_id name phone_number normalized_phone_number timestamp ref_no lid normalized_lid")
        .limit(5)
        .lean()
        .exec();
      return docs.map(asLeadDoc);
    },
    async findFormLeadsByPhoneNameDate(input) {
      const docs = await FormLead.find({
        source_company: "best_relocation_leads",
        duplicate: { $ne: true },
        timestamp: { $gte: BEST_RELOCATION_CUTOFF },
        $or: [
          { normalized_phone_number: input.phone },
          { phone_number: input.phone },
        ],
      })
        .select("_id name phone_number normalized_phone_number timestamp ref_no lid normalized_lid")
        .limit(20)
        .lean()
        .exec();
      return docs.map(asLeadDoc);
    },
    async findCallLeadsByPhoneTimestamp(input) {
      const persisted = toFloridaTimestamp(input.timestamp);
      const docs = await CallLead.find({
        source_company: "best_relocation_leads",
        duplicate: { $ne: true },
        normalized_phone_number: input.phone,
        timestamp: {
          $gte: new Date(persisted.getTime() - 1_000),
          $lte: new Date(persisted.getTime() + 1_000),
        },
      })
        .select("_id name phone_number normalized_phone_number timestamp")
        .limit(5)
        .lean()
        .exec();
      return docs.map(asLeadDoc);
    },
    async findBookingsByJob(normalizedJobNo) {
      if (!normalizedJobNo) return [];
      const docs = await BookedLead.find({ normalized_job_no: normalizedJobNo })
        .select("_id normalized_job_no")
        .limit(5)
        .lean()
        .exec();
      return docs.map((doc) => ({
        id: String(doc._id),
        normalized_job_no: doc.normalized_job_no,
      }));
    },
    async findCancellationsByBooking(bookingId) {
      const docs = await CancelledLead.find({ booked_lead: bookingId })
        .select("_id booked_lead")
        .limit(5)
        .lean()
        .exec();
      return docs.map((doc) => ({
        id: String(doc._id),
        booked_lead: String(doc.booked_lead),
      }));
    },
  };
}

function formPhoneNameDateMatches(
  doc: CanonicalLeadDoc,
  phone: string,
  name: string,
  timestamp: Date,
): boolean {
  if (!doc.timestamp || doc.timestamp.getTime() < BEST_RELOCATION_CUTOFF.getTime()) {
    return false;
  }
  const docPhone =
    normalizePhoneNumberForMatch(doc.normalized_phone_number) ??
    normalizePhoneNumberForMatch(doc.phone_number);
  const docName = normalizeComparisonName(doc.name);
  return (
    docPhone === phone &&
    docName === name &&
    newYorkDateKey(doc.timestamp) === newYorkDateKey(timestamp)
  );
}

async function adoptCallLead(
  action: BestRelocationPlanAction,
  store: CanonicalAdoptionStore,
): Promise<BestRelocationPlanAction> {
  const payload = action.command_payload ?? {};
  const phone = normalizePhoneNumberForMatch(stringValue(payload.phone_number));
  const timestamp = parseTimestamp(payload.timestamp);
  if (!phone || !timestamp) return action;
  const docs = await store.findCallLeadsByPhoneTimestamp({ phone, timestamp });
  if (docs.length === 1) {
    return asAdopted(action, [{ model: "CallLead", id: docs[0].id }], "phone_timestamp");
  }
  if (docs.length > 1) {
    return asConflict(
      action,
      docs.map((doc) => ({ model: "CallLead", id: doc.id })),
    );
  }
  return action;
}

async function adoptBooking(
  action: BestRelocationPlanAction,
  store: CanonicalAdoptionStore,
): Promise<BestRelocationPlanAction> {
  const payload = action.command_payload ?? {};
  const job = normalizeJob(stringValue(payload.job_no ?? payload.call_job_no));
  if (!job) return action;
  const docs = await store.findBookingsByJob(job);
  if (docs.length === 1) {
    return asAdopted(action, [{ model: "BookedLead", id: docs[0].id }], "job_no");
  }
  if (docs.length > 1) {
    return asConflict(
      action,
      docs.map((doc) => ({ model: "BookedLead", id: doc.id })),
    );
  }
  return action;
}

async function adoptCancellation(
  action: BestRelocationPlanAction,
  store: CanonicalAdoptionStore,
  bookingId: string | undefined,
): Promise<BestRelocationPlanAction> {
  if (!bookingId) return action;
  const docs = await store.findCancellationsByBooking(bookingId);
  if (docs.length === 1) {
    return asAdopted(
      action,
      [{ model: "CancelledLead", id: docs[0].id }],
      "booking_refund",
    );
  }
  if (docs.length > 1) {
    return asConflict(
      action,
      docs.map((doc) => ({ model: "CancelledLead", id: doc.id })),
    );
  }
  return action;
}

function remapLeadAction(
  action: BestRelocationPlanAction,
  decision: FormLeadAdoptionDecision,
): BestRelocationPlanAction {
  if (decision.classification === "adopt") {
    return asAdopted(action, decision.refs, decision.method);
  }
  if (decision.classification === "conflict") {
    return asConflict(action, decision.refs);
  }
  return action;
}

function asAdopted(
  action: BestRelocationPlanAction,
  refs: Array<{ model: string; id: string }>,
  method: string,
): BestRelocationPlanAction {
  const { command_payload: _payload, ...rest } = action;
  return {
    ...rest,
    command: "adopt_existing",
    classification: "adoption",
    adopted_entity_refs: refs,
    matching: {
      method,
      score: method === "phone_name_date" ? 0.95 : 1,
      calibration_version: MATCH_CALIBRATION_VERSION,
      evidence: refs.map((ref) => `${ref.model}:${ref.id}`),
    },
  };
}

function asConflict(
  action: BestRelocationPlanAction,
  refs?: Array<{ model: string; id: string }>,
): BestRelocationPlanAction {
  return {
    ...action,
    command: "record_conflict",
    classification: "conflict",
    conflict: { type: "ambiguous_lead_match", severity: "blocking" },
    ...(refs?.length ? { adopted_entity_refs: refs } : {}),
  };
}

function uniqueIdentities(payload: Record<string, unknown>): string[] {
  return [...new Set(
    [payload.ref_no, payload.lid]
      .map(stringValue)
      .filter((value): value is string => Boolean(value)),
  )];
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function parseTimestamp(value: unknown): Date | undefined {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

function normalizeJob(value: string | undefined): string | undefined {
  const job = value?.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return job || undefined;
}

function newYorkDateKey(timestamp: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BEST_RELOCATION_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(timestamp);
}

function asLeadDoc(doc: {
  _id: unknown;
  name?: string;
  phone_number?: string;
  normalized_phone_number?: string;
  timestamp?: Date;
  ref_no?: string;
  lid?: string;
  normalized_lid?: string;
}): CanonicalLeadDoc {
  return {
    id: String(doc._id),
    name: doc.name,
    phone_number: doc.phone_number,
    normalized_phone_number: doc.normalized_phone_number,
    timestamp: doc.timestamp,
    ref_no: doc.ref_no,
    lid: doc.lid,
    normalized_lid: doc.normalized_lid,
  };
}

function countClassifications(
  actions: BestRelocationPlanAction[],
): Record<string, number> {
  return actions.reduce<Record<string, number>>((counts, action) => {
    counts[action.classification] = (counts[action.classification] ?? 0) + 1;
    return counts;
  }, {});
}
