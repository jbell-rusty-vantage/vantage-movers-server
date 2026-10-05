import type { ClientSession } from "mongoose";
import { SALES_OUTREACH_COMMAND_KINDS, SALES_OUTREACH_CONTRACT_VERSION } from "../../../config/domain/salesOutreach";
import type {
  SalesOutreachRestrictionCommandResponse,
  SalesOutreachRestrictionDto,
  SalesOutreachRestrictionsResponse,
} from "../../../validation/v1/salesOutreachCommands";
import { CsiError, type CsiActor } from "../../salesIntelligence/auth";
import { appendCsiAudit, executeCsiCommand, type CsiTransactionContext } from "../../salesIntelligence/transactions";
import type { OutreachActor } from "../auth";
import { OutreachError } from "../errors";
import { evaluationJob } from "../evaluation/evaluateJob";
import type { DeskRestrictionRow } from "../evaluation/store";
import { commandLoader, commandStore, requireCommandConfiguration, wakeCommandJobs, type DeskCommandDeps } from "./common";
import type { DeskCommandStore } from "./store";

/**
 * Owner contact-restriction review (P06c, IMPLEMENTATION-PLAN §4.9, P09b "lifting contact
 * restrictions" Owner-only). `sales_intelligence_contact_restrictions` keeps its 15 active AI-origin
 * rows: they stay active and blocking until the Owner confirms (still blocking, now reviewed) or lifts
 * (released, with a reason and actor; the interval stays in history). Nothing ever clears a
 * restriction silently. The Owner may also add a restriction to a Contact Number. Every subject on
 * the number is re-evaluated after a change that alters the blocking interval.
 */

type RestrictionResult = Omit<SalesOutreachRestrictionCommandResponse, "replayed">;
const RESTRICTION_AUDIT_KEY = (id: string) => `contact-restriction:${id}`;
const iso = (d: Date | null) => (d ? d.toISOString() : null);
/** The stored strict `actor` sub-document (enumerable trusted fields only). */
const storedActor = (actor: CsiActor) => ({ kind: actor.kind, id: actor.id, request_id: actor.request_id, run_id: actor.run_id });

export function restrictionDto(row: DeskRestrictionRow): SalesOutreachRestrictionDto {
  return {
    restriction_id: row.id,
    contact_number_id: row.contact_number_id,
    channels: [...new Set(row.channels.map((c) => (c === "text" ? ("sms" as const) : ("call" as const))))],
    origin: row.origin,
    state: row.state,
    effective_at: row.created_at.toISOString(),
    until: iso(row.until),
    reason: row.reason,
    needs_review: row.state === "active" && row.origin === "intelligence" && row.confirmed_at === null,
    confirmed_at: iso(row.confirmed_at),
    confirmed_by: row.confirmed_by,
    resolved_at: iso(row.resolved_at),
    resolved_by: row.resolved_by,
    resolution_reason: row.resolution_reason,
    revision: row.revision,
  };
}

const ownerOnly = (actor: OutreachActor) => {
  if (actor.role !== "owner") throw new OutreachError("FORBIDDEN");
};

/** Re-evaluates every subject attached to the number (bounded), in the command transaction. */
async function nominateNumberSubjects(store: DeskCommandStore, contactNumberId: string, cause: string, context: CsiTransactionContext, wake: string[]) {
  for (const subjectId of await store.subjectIdsForNumber(contactNumberId, context.session)) {
    const job = await store.enqueue(evaluationJob(subjectId, cause), context.session, context.now);
    if (job.created) wake.push(job.job_id);
  }
}

async function runRestrictionCommand(
  input: { actor: OutreachActor; command: string; idempotency_key: string; payload: unknown },
  deps: DeskCommandDeps,
  operation: (context: CsiTransactionContext, store: DeskCommandStore, wake: string[]) => Promise<RestrictionResult>,
): Promise<SalesOutreachRestrictionCommandResponse> {
  ownerOnly(input.actor);
  const wake: string[] = [];
  const { response, replayed } = await (deps.run ?? executeCsiCommand)<RestrictionResult>({
    actor: input.actor.actor,
    command: input.command,
    idempotency_key: input.idempotency_key,
    payload: input.payload,
    operation: async (context) => {
      wake.length = 0;
      await requireCommandConfiguration(commandLoader(deps), context.session, { desk: false });
      return operation(context, commandStore(deps), wake);
    },
  });
  if (!replayed) await wakeCommandJobs(wake, deps.publish);
  return { ...response, replayed };
}

async function loadForUpdate(store: DeskCommandStore, id: string, expectedRevision: number, session: ClientSession) {
  const row = await store.getRestriction(id, session);
  if (!row) throw new OutreachError("NOT_FOUND");
  if (row.revision !== expectedRevision) throw new CsiError("REVISION_CONFLICT");
  if (row.state !== "active") throw new OutreachError("INVALID_INPUT", [{ path: "restriction", code: "restriction_not_active" }]);
  return row;
}

export async function addRestriction(
  input: { actor: OutreachActor; idempotency_key: string; contact_number_id: string; channels: Array<"call" | "sms">; until: string | null; reason: string },
  deps: DeskCommandDeps = {},
) {
  const until = input.until ? new Date(input.until) : null;
  const channels = [...new Set(input.channels)].sort().map((c) => (c === "sms" ? ("text" as const) : ("call" as const)));
  return runRestrictionCommand(
    {
      actor: input.actor,
      command: SALES_OUTREACH_COMMAND_KINDS.restriction_add,
      idempotency_key: input.idempotency_key,
      payload: { contact_number_id: input.contact_number_id, channels, until: iso(until), reason: input.reason },
    },
    deps,
    async (context, store, wake) => {
      if (!(await store.contactNumberExists(input.contact_number_id, context.session)))
        throw new OutreachError("INVALID_INPUT", [{ path: "contact_number_id", code: "contact_number_not_found" }]);
      if (until && +until <= +context.now) throw new OutreachError("INVALID_INPUT", [{ path: "until", code: "until_not_future" }]);
      const id = await store.insertRestriction({ contact_number_id: input.contact_number_id, channels, until, reason: input.reason, actor: storedActor(context.actor) as CsiActor }, context.session);
      const row = await store.getRestriction(id, context.session);
      if (!row) throw new CsiError("REVISION_CONFLICT");
      await (deps.audit ?? appendCsiAudit)(context, {
        subject_key: RESTRICTION_AUDIT_KEY(id),
        event_kind: "sales_outreach_restriction_added",
        prior: {},
        current: { contact_number_id: input.contact_number_id, channels, until: iso(until), reason: input.reason, origin: "owner" },
        target_id: id,
        revision: 1,
        kind: "restriction",
      });
      await nominateNumberSubjects(store, input.contact_number_id, `restriction:${id}:r1`, context, wake);
      return { contract_version: SALES_OUTREACH_CONTRACT_VERSION, restriction: restrictionDto(row), changed: true };
    },
  );
}

export async function confirmRestriction(
  input: { actor: OutreachActor; idempotency_key: string; restriction_id: string; expected_revision: number },
  deps: DeskCommandDeps = {},
) {
  return runRestrictionCommand(
    {
      actor: input.actor,
      command: SALES_OUTREACH_COMMAND_KINDS.restriction_confirm,
      idempotency_key: input.idempotency_key,
      payload: { restriction_id: input.restriction_id, expected_revision: input.expected_revision },
    },
    deps,
    async (context, store) => {
      const row = await loadForUpdate(store, input.restriction_id, input.expected_revision, context.session);
      if (row.confirmed_at) return { contract_version: SALES_OUTREACH_CONTRACT_VERSION, restriction: restrictionDto(row), changed: false };
      if (!(await store.updateRestriction(row.id, row.revision, { confirmed_at: context.now, confirmation_actor: storedActor(context.actor) }, context.session)))
        throw new CsiError("REVISION_CONFLICT");
      await (deps.audit ?? appendCsiAudit)(context, {
        subject_key: RESTRICTION_AUDIT_KEY(row.id),
        event_kind: "sales_outreach_restriction_confirmed",
        prior: { state: row.state, origin: row.origin, confirmed_at: null, revision: row.revision },
        current: { state: row.state, confirmed_at: context.now.toISOString(), revision: row.revision + 1 },
        target_id: row.id,
        revision: row.revision + 1,
        kind: "restriction",
      });
      const updated = (await store.getRestriction(row.id, context.session)) ?? row;
      // Confirming changes no blocking interval: nothing is re-evaluated.
      return { contract_version: SALES_OUTREACH_CONTRACT_VERSION, restriction: restrictionDto(updated), changed: true };
    },
  );
}

export async function liftRestriction(
  input: { actor: OutreachActor; idempotency_key: string; restriction_id: string; expected_revision: number; reason: string },
  deps: DeskCommandDeps = {},
) {
  return runRestrictionCommand(
    {
      actor: input.actor,
      command: SALES_OUTREACH_COMMAND_KINDS.restriction_lift,
      idempotency_key: input.idempotency_key,
      payload: { restriction_id: input.restriction_id, expected_revision: input.expected_revision, reason: input.reason },
    },
    deps,
    async (context, store, wake) => {
      const row = await loadForUpdate(store, input.restriction_id, input.expected_revision, context.session);
      const set = { state: "resolved", resolved_at: context.now, resolution_actor: storedActor(context.actor), resolution_reason: input.reason };
      if (!(await store.updateRestriction(row.id, row.revision, set, context.session))) throw new CsiError("REVISION_CONFLICT");
      await (deps.audit ?? appendCsiAudit)(context, {
        subject_key: RESTRICTION_AUDIT_KEY(row.id),
        event_kind: "sales_outreach_restriction_lifted",
        prior: { state: row.state, origin: row.origin, until: iso(row.until), confirmed_at: iso(row.confirmed_at), revision: row.revision },
        current: { state: "resolved", resolved_at: context.now.toISOString(), resolution_reason: input.reason, revision: row.revision + 1 },
        target_id: row.id,
        revision: row.revision + 1,
        kind: "restriction",
      });
      await nominateNumberSubjects(store, row.contact_number_id, `restriction:${row.id}:r${row.revision + 1}`, context, wake);
      const updated = (await store.getRestriction(row.id, context.session)) ?? row;
      return { contract_version: SALES_OUTREACH_CONTRACT_VERSION, restriction: restrictionDto(updated), changed: true };
    },
  );
}

/** `GET /restrictions` (Owner): newest first, one page, opaque `_id` cursor. Read-only. */
export async function listRestrictions(
  actor: OutreachActor,
  query: { state: "active" | "resolved" | "expired" | "all"; cursor?: string; limit: number },
  deps: DeskCommandDeps & { now?: Date } = {},
): Promise<SalesOutreachRestrictionsResponse> {
  ownerOnly(actor);
  await commandLoader(deps).requireActive();
  const rows = await commandStore(deps).listRestrictions({ state: query.state, after_id: query.cursor ?? null, limit: query.limit + 1 });
  const page = rows.slice(0, query.limit);
  return {
    contract_version: SALES_OUTREACH_CONTRACT_VERSION,
    as_of: (deps.now ?? new Date()).toISOString(),
    state: query.state,
    restrictions: page.map(restrictionDto),
    next_cursor: rows.length > query.limit ? page.at(-1)!.id : null,
  };
}
