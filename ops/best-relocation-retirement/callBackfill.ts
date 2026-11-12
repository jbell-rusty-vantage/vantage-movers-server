import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain";
import { getCallLeadModel } from "../../src/models/CallLead";
import { hasQualifiedRingCentralCall } from "../../src/services/ringcentral/callLeadQualification";
import { vetRingCentralCallLogRecord } from "../../src/services/ringcentral/call-log-vetting";
import { getCallLeadReportingDecision, isOvernightCallArrival, type CallReportingDecision } from "../../src/services/leads/callLeadReportingDisposition";
import { hasFormFillForCallLead } from "../../src/services/leads/duplicateLead.service";
import { persistRingCentralFinalCallLogResult, type FinalCallLogResultObservation } from "../../src/services/domainCommands/ringcentralFinalResult";
import { repairCallFormFillForReporting } from "../../src/services/domainCommands/callFormFillBackfill";
import type { CanonicalCommandContext } from "../../src/services/domainCommands/types";
import type { DurableActor } from "../../src/services/durableWork/types";
import { finalizeSheetSync, persistSheetSyncIntent } from "../../src/services/sheetSync";
import { withTransaction } from "../../src/db";
import { loadInsightsCatalog } from "../../src/services/insights/catalog";
import { priceForDay } from "../../src/services/insights/pricing";
import { easternDayKey } from "../../src/services/dailyOperations/dayDocument";
import { leadInstant } from "../../src/services/salesOutreach/subjects/leadInstant";
import { createCallBackfillScan, type CallBackfillCursor, type CallBackfillPageRequest, type CallBackfillQueryEvidence } from "./callBackfillScan";
import { createCallBackfillProviderReader } from "./callBackfillProvider";

export const CALL_BACKFILL_FROM = "2026-11-01T04:00:00.000Z";
export const CALL_BACKFILL_VERSION = "call-reporting-backfill-v1";
type CallRow = Record<string, any>;
type Cursor = CallBackfillCursor;
type PageRequest = CallBackfillPageRequest;
type StoredObservation = { telephonySessionId: string | null; callLogId: string | null; startTime: string; finalCallLogResult: { result: string; observedAt: string; callLogId: string | null; answered: boolean } };
export type CallBackfillItem = {
  lead_id: string; expected_revision: number; source_granularity_id: string | null;
  arrival: string | null; qualified: boolean; repair_form_fill: boolean;
  result_observation?: StoredObservation;
  before: CallReportingDecision; desired: CallReportingDecision;
  legacy_billable: boolean; qualified_baseline_billable?: boolean; live_rate: number | null;
  unresolved: string[];
};
export type CallBackfillPlan = {
  version: typeof CALL_BACKFILL_VERSION; database: string; deployment_id: string;
  from: typeof CALL_BACKFILL_FROM; through: string; timestamp_padding_ms: number;
  provider_account_id: string | null;
  scan: { primary_count: number; boundary_count: number; unqualified_count: number };
  query_evidence?: CallBackfillQueryEvidence;
  coverage_exclusions?: Array<{ lead_id: string; arrival: string; telephony_session_id: string | null; call_log_id: string | null }>;
  timestamp_discrepancies: Array<{ lead_id: string; stored_timestamp: string | null; saved_arrival: string; discrepancy_ms: number | null; outside_widened_range: boolean }>;
  items: CallBackfillItem[];
  totals: ReturnType<typeof callBackfillTotals>;
  checksum: string;
};
export type CallBackfillDependencies = {
  connect(): Promise<void>;
  database(): string;
  scopes(): Promise<Array<string | null>>;
  page(request: PageRequest): Promise<CallRow[]>;
  queryEvidence?(): Promise<CallBackfillQueryEvidence>;
  load(id: string): Promise<CallRow | null>;
  hasEligibleForm(call: CallRow): Promise<boolean>;
  liveRate(call: CallRow, arrival: Date): Promise<number | null>;
  providerAccount(): Promise<string>;
  providerRecords(call: CallRow): Promise<{ records: unknown[]; complete: boolean }>;
  repairForm: typeof repairCallFormFillForReporting;
  persistResult: typeof persistRingCentralFinalCallLogResult;
  reproject(id: string): Promise<void>;
};
const projection = {
  _id: 1, domain_revision: 1, timestamp: 1, createdAt: 1, ingestion_origin: 1,
  source_company: 1, lead_source_company: 1, source_granularity_id: 1,
  phone_number: 1, duplicate: 1, form_fill: 1,
  "ringcentral.telephony_session_id": 1, "ringcentral.call_log_id": 1,
  "ringcentral.ingestion_source": 1, "ringcentral.qualification_reason": 1,
  "ringcentral.duration_seconds": 1, "ringcentral.start_time": 1,
  "ringcentral.final_result": 1, "ringcentral.final_result_observed_at": 1,
  "ringcentral.final_result_call_log_id": 1, "ringcentral.final_result_answered": 1,
  created_on_unmatched: 1, no_sync: 1, external_sheet_review: 1, external_call_admission: 1,
};
function defaults(): CallBackfillDependencies {
  let catalog: ReturnType<typeof loadInsightsCatalog> | undefined;
  const scan = createCallBackfillScan(projection);
  const readProvider = createCallBackfillProviderReader();
  return {
    connect: connectMongo, database: getMongoDatabaseName,
    scopes: scan.scopes, page: scan.page, queryEvidence: scan.queryEvidence,
    load: async (id) => await getCallLeadModel().findById(id).select(projection).lean().exec(),
    hasEligibleForm: (call) => hasFormFillForCallLead({ sourceCompany: call.source_company, leadSourceCompany: call.lead_source_company }, call.phone_number),
    liveRate: async (call, arrival) => {
      catalog ??= loadInsightsCatalog();
      const rates = await catalog;
      return priceForDay(rates.periodsByFeed.get(String(call.source_granularity_id ?? "")), easternDayKey(arrival));
    },
    providerAccount: async () => {
      const account = await readProvider("/restapi/v1.0/account/~");
      if (typeof account.id !== "string" && typeof account.id !== "number") throw new Error("provider_account_unverified");
      return String(account.id);
    },
    providerRecords: async (call) => {
      const rc = call.ringcentral ?? {};
      if (rc.call_log_id) {
        const record = await readProvider(`/restapi/v1.0/account/~/call-log/${encodeURIComponent(rc.call_log_id)}?view=Detailed`);
        return { records: [record], complete: true };
      }
      if (!rc.telephony_session_id) return { records: [], complete: true };
      const query = new URLSearchParams({ telephonySessionId: rc.telephony_session_id, view: "Detailed", perPage: "100", type: "Voice", direction: "Inbound" });
      const response = await readProvider(`/restapi/v1.0/account/~/call-log?${query}`);
      return { records: response.records ?? [], complete: !response.navigation?.nextPage };
    },
    repairForm: repairCallFormFillForReporting,
    persistResult: persistRingCentralFinalCallLogResult,
    reproject: async (id) => {
      const job = { resource: "source_lead", operation: "call_lead.reporting_backfill", leadModel: "CallLead", leadId: id } as const;
      await withTransaction(async (session) => persistSheetSyncIntent(job, session));
      await finalizeSheetSync(job);
    },
  };
}
const instant = (value: unknown): Date | null => {
  if (!(value instanceof Date) && !(typeof value === "string" && /(?:Z|[+-]\d\d:\d\d)$/.test(value))) return null;
  const parsed = new Date(value as string);
  return Number.isFinite(+parsed) ? parsed : null;
};
function checksum(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function callBackfillPlanChecksum(plan: Omit<CallBackfillPlan, "checksum"> | CallBackfillPlan): string {
  const { checksum: ignored, ...body } = plan as CallBackfillPlan;
  return checksum(body);
}
function storedObservation(observation: FinalCallLogResultObservation): StoredObservation {
  const fact = observation.finalCallLogResult!;
  return { ...observation, startTime: observation.startTime!.toISOString(), finalCallLogResult: { ...fact, observedAt: fact.observedAt.toISOString() } };
}
function restoredObservation(observation: StoredObservation): FinalCallLogResultObservation {
  return { ...observation, startTime: new Date(observation.startTime), finalCallLogResult: { ...observation.finalCallLogResult, observedAt: new Date(observation.finalCallLogResult.observedAt) } };
}

/** Historical qualification is already saved; current route activation never requalifies it. */
export function recoverCallBackfillObservation(call: CallRow, records: unknown[], observedAt: Date): { observation?: FinalCallLogResultObservation; unresolved?: string } {
  const rc = call.ringcentral ?? {};
  if (!hasQualifiedRingCentralCall(rc)) return { unresolved: "missing_saved_qualification" };
  const matches = records.filter((value) => {
    if (!value || typeof value !== "object") return false;
    const row = value as Record<string, unknown>;
    const sameSession = !!rc.telephony_session_id && row.telephonySessionId === rc.telephony_session_id;
    const sameLog = !!rc.call_log_id && String(row.id ?? "") === rc.call_log_id;
    return (sameSession || sameLog) && !(rc.telephony_session_id && row.telephonySessionId && row.telephonySessionId !== rc.telephony_session_id);
  });
  if (matches.length !== 1) return { unresolved: matches.length ? "ambiguous_call_log_identity" : "call_log_not_found" };
  const record = matches[0] as Record<string, unknown>;
  const vet = vetRingCentralCallLogRecord(record);
  if (record.finished !== true || record.type !== "Voice" || vet.direction !== "Inbound" || !vet.startTime || !vet.callLogId || !vet.result) {
    return { unresolved: "final_caller_result_unconfirmed" };
  }
  const savedArrival = instant(rc.start_time);
  if (savedArrival && +savedArrival !== +vet.startTime) return { unresolved: "provider_arrival_conflict" };
  return { observation: {
    telephonySessionId: vet.telephonySessionId, callLogId: vet.callLogId, startTime: vet.startTime,
    finalCallLogResult: { result: vet.result, observedAt, callLogId: vet.callLogId, answered: vet.answered },
  } };
}
function withObservation(call: CallRow, observation: FinalCallLogResultObservation): CallRow {
  const fact = observation.finalCallLogResult!;
  return { ...call, ringcentral: { ...call.ringcentral,
    start_time: call.ringcentral?.start_time ?? observation.startTime,
    call_log_id: fact.callLogId, final_result: fact.result,
    final_result_observed_at: fact.observedAt, final_result_call_log_id: fact.callLogId,
    final_result_answered: fact.answered,
  } };
}
export function callBackfillTotals(items: CallBackfillItem[]) {
  const money = (value: number) => Math.round(value * 100) / 100;
  const billable = (select: (item: CallBackfillItem) => boolean) => items.reduce((sum, item) => sum + Number(select(item)), 0);
  const spend = (select: (item: CallBackfillItem) => boolean) => money(items.reduce((sum, item) => sum + (select(item) ? item.live_rate ?? 0 : 0), 0));
  return {
    candidates: items.length, qualified: items.filter(item => item.qualified).length,
    unresolved: items.filter(item => item.unresolved.length).length,
    unpriced: items.filter(item => (item.qualified || item.legacy_billable) && item.live_rate == null).length,
    legacy_billable: billable(item => item.legacy_billable),
    qualified_baseline_billable: billable(item => item.qualified_baseline_billable ?? (item.qualified && item.legacy_billable)),
    before_billable: billable(item => item.before.billable), after_billable: billable(item => item.desired.billable),
    legacy_live_cost: spend(item => item.legacy_billable),
    qualified_baseline_live_cost: spend(item => item.qualified_baseline_billable ?? (item.qualified && item.legacy_billable)),
    before_live_cost: spend(item => item.before.billable), after_live_cost: spend(item => item.desired.billable),
    billing_count_delta: billable(item => item.desired.billable) - billable(item => item.legacy_billable),
    billing_live_cost_delta: money(spend(item => item.desired.billable) - spend(item => item.legacy_billable)),
    by_disposition: Object.fromEntries(["excluded", "calls", "duplicate_calls", "bad_call_leads"].map(kind => [kind, items.filter(item => item.desired.disposition === kind).length])),
    by_reason: Object.fromEntries([...new Set(items.flatMap(item => item.desired.reason_codes))].sort().map(reason => [reason, items.filter(item => item.desired.reason_codes.includes(reason)).length])),
  };
}

/** Read-only, fixed-watermark plan. Contains opaque entity IDs; no caller contacts. */
export async function planCallBackfill(input: { through: string; deploymentId: string; timestampPaddingMs?: number; pageSize?: number }, overrides: Partial<CallBackfillDependencies> = {}): Promise<CallBackfillPlan> {
  const deps = { ...defaults(), ...overrides };
  const through = instant(input.through), from = new Date(CALL_BACKFILL_FROM);
  if (!through || +through < +from || !input.deploymentId.trim()) throw new Error("Fixed through instant and deployment evidence are required");
  const padding = input.timestampPaddingMs ?? 86_400_000;
  const pageSize = input.pageSize ?? 100;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 250 || !Number.isFinite(padding) || padding < 6 * 3_600_000) throw new Error("Invalid bounded scan parameters");
  await deps.connect();
  const plan: CallBackfillPlan = {
    version: CALL_BACKFILL_VERSION, database: deps.database(), deployment_id: input.deploymentId,
    from: CALL_BACKFILL_FROM, through: through.toISOString(), timestamp_padding_ms: padding,
    provider_account_id: null, scan: { primary_count: 0, boundary_count: 0, unqualified_count: 0 },
    coverage_exclusions: [], timestamp_discrepancies: [], items: [], totals: callBackfillTotals([]), checksum: "",
  };
  let accountChecked = false;
  const observedAt = new Date();
  for (const scope of await deps.scopes()) for (const kind of ["primary", "boundary"] as const) {
    let cursor: Cursor | undefined;
    while (true) {
      const rows = await deps.page({ scope, kind, cursor, from, through, scanFrom: new Date(+from - padding), scanThrough: new Date(+through + padding), limit: pageSize });
      if (!rows.length) break;
      for (const call of rows) {
        plan.scan[kind === "primary" ? "primary_count" : "boundary_count"]++;
        const id = String(call._id), qualified = hasQualifiedRingCentralCall(call.ringcentral);
        let arrival = instant(call.ringcentral?.start_time), desired = call;
        const unresolved: string[] = [];
        let observation: FinalCallLogResultObservation | undefined;
        const overnight = arrival && isOvernightCallArrival(call);
        const finalComplete = typeof call.ringcentral?.final_result === "string" &&
          instant(call.ringcentral?.final_result_observed_at) &&
          typeof call.ringcentral?.final_result_answered === "boolean" &&
          call.ringcentral?.final_result_call_log_id && call.ringcentral?.final_result_call_log_id === call.ringcentral?.call_log_id;
        if (arrival && (+arrival < +from || +arrival > +through)) continue;
        if (qualified && (!arrival || (overnight && !finalComplete))) {
          if (!accountChecked) {
            accountChecked = true;
            try { plan.provider_account_id = await deps.providerAccount(); } catch { /* unavailable evidence is retained below */ }
          }
          if (!plan.provider_account_id) unresolved.push("provider_account_unverified");
          else try {
            const response = await deps.providerRecords(call);
            const recovered = response.complete ? recoverCallBackfillObservation(call, response.records, observedAt) : { unresolved: "incomplete_call_log_response" };
            if (recovered.observation) {
              observation = recovered.observation;
              desired = withObservation(call, observation);
              arrival = instant(desired.ringcentral?.start_time);
            } else unresolved.push(recovered.unresolved!);
          } catch { unresolved.push("call_log_lookup_unavailable"); }
        }
        if (arrival && (+arrival < +from || +arrival > +through)) {
          if (observation) plan.coverage_exclusions!.push({ lead_id: id, arrival: arrival.toISOString(),
            telephony_session_id: observation.telephonySessionId, call_log_id: observation.callLogId });
          continue;
        }
        if (!arrival) unresolved.push("original_arrival_unresolved");
        if (!qualified) { plan.scan.unqualified_count++; unresolved.push("missing_saved_qualification"); }
        const repairForm = qualified && call.form_fill !== true && await deps.hasEligibleForm(call);
        if (repairForm) desired = { ...desired, form_fill: true };
        const before = getCallLeadReportingDecision(call), after = getCallLeadReportingDecision(desired);
        const legacyBillable = call.created_on_unmatched !== true && call.duplicate !== true;
        // Existing pricing reads the stored Lead billing day. This fallback is
        // cost evidence only; it never supplies the missed-call arrival predicate.
        const pricingInstant = arrival ?? leadInstant(call);
        const liveRate = (qualified || legacyBillable) && pricingInstant ? await deps.liveRate(call, pricingInstant) : null;
        if (liveRate == null && (legacyBillable || after.billable)) unresolved.push("live_rate_unresolved");
        if (after.reason_codes.includes("conflicting_final_result")) unresolved.push("conflicting_final_result");
        if (arrival) {
          const leadTime = leadInstant(call), difference = leadTime ? +arrival - +leadTime : null;
          if (difference !== 0 || kind === "boundary") plan.timestamp_discrepancies.push({
            lead_id: id, stored_timestamp: instant(call.timestamp)?.toISOString() ?? null,
            saved_arrival: arrival.toISOString(), discrepancy_ms: difference, outside_widened_range: kind === "boundary",
          });
        }
        plan.items.push({ lead_id: id, expected_revision: Number(call.domain_revision ?? 0), source_granularity_id: call.source_granularity_id ? String(call.source_granularity_id) : null,
          arrival: arrival?.toISOString() ?? null, qualified, repair_form_fill: repairForm,
          ...(observation ? { result_observation: storedObservation(observation) } : {}),
          before, desired: after, legacy_billable: legacyBillable, qualified_baseline_billable: qualified && legacyBillable,
          live_rate: liveRate, unresolved,
        });
      }
      const last = rows.at(-1)!;
      const next = { timestamp: instant(last.timestamp)?.toISOString() ?? null, id: String(last._id) };
      if (cursor && JSON.stringify(cursor) === JSON.stringify(next)) throw new Error("Call backfill cursor did not advance");
      cursor = next;
      if (rows.length < pageSize) break;
    }
  }
  plan.totals = callBackfillTotals(plan.items);
  const readEvidence = overrides.queryEvidence ?? (overrides.page ? undefined : deps.queryEvidence);
  plan.query_evidence = readEvidence ? await readEvidence() : { strategy: "injected_pages", max_time_ms: 0, pages: 0, rows_returned: plan.scan.primary_count + plan.scan.boundary_count, explain_samples: [] };
  plan.checksum = callBackfillPlanChecksum(plan);
  return plan;
}

function assertPlan(plan: CallBackfillPlan, expectedChecksum: string, database: string) {
  if (plan.version !== CALL_BACKFILL_VERSION || plan.from !== CALL_BACKFILL_FROM ||
      !instant(plan.through) || Date.parse(plan.through) < Date.parse(CALL_BACKFILL_FROM) ||
      !Number.isFinite(plan.timestamp_padding_ms) || plan.timestamp_padding_ms < 6 * 3_600_000 ||
      plan.checksum !== expectedChecksum || callBackfillPlanChecksum(plan) !== expectedChecksum ||
      plan.database !== database) throw new Error("Call backfill plan checksum/version/database mismatch");
}
export async function applyCallBackfill(plan: CallBackfillPlan, options: {
  checksum: string; expectedDatabase: string; owner: DurableActor;
  assertLease(): Promise<void>;
  checkpoint?(action: string, leadId: string): Promise<void>;
}, overrides: Partial<CallBackfillDependencies> = {}) {
  const deps = { ...defaults(), ...overrides };
  await deps.connect();
  assertPlan(plan, options.checksum, deps.database());
  if (deps.database() !== options.expectedDatabase || !["owner", "admin"].includes(options.owner.actor_type) || options.owner.origin !== "vantage_admin") throw new Error("Expected database and authenticated owner/admin required");
  const completed: string[] = [], conflicts: Array<{ lead_id: string; reason: string }> = [];
  // Eligible Form facts commit before any final Call membership is enqueued.
  for (const item of plan.items.filter(item => item.qualified && item.repair_form_fill)) {
    await options.assertLease();
    const payloadChecksum = checksum({ plan: plan.checksum, lead_id: item.lead_id, revision: item.expected_revision, purpose: "form_fill" });
    const context: CanonicalCommandContext = {
      command_id: `call-backfill:${payloadChecksum}`, idempotency_key: `call-backfill:form-fill:${payloadChecksum}`, payload_checksum: payloadChecksum,
      actor: options.owner, initiator: options.owner,
      provenance: { origin: "vantage_admin", run_id: null, source_receipt_id: null, source_connection_key: null },
    };
    try {
      await deps.repairForm({ lead_id: item.lead_id, expected_revision: item.expected_revision, context });
      await options.checkpoint?.("form_fill", item.lead_id);
    } catch { conflicts.push({ lead_id: item.lead_id, reason: "form_fill_proof_or_revision_changed" }); }
  }
  for (const item of plan.items.filter(item => item.qualified)) {
    await options.assertLease();
    if (conflicts.some(conflict => conflict.lead_id === item.lead_id)) continue;
    const live = await deps.load(item.lead_id);
    if (!live || !hasQualifiedRingCentralCall(live.ringcentral)) { conflicts.push({ lead_id: item.lead_id, reason: "saved_qualification_changed" }); continue; }
    const expectedRevision = item.expected_revision + Number(item.repair_form_fill);
    if (Number(live.domain_revision ?? 0) !== expectedRevision) {
      // A completed replay may already have both desired facts. An unrelated
      // revision with a remaining mutation is a conflict and requires a tail plan.
      const alreadyHasResult = !item.result_observation ||
        live.ringcentral?.final_result === item.result_observation.finalCallLogResult.result &&
        live.ringcentral?.final_result_answered === item.result_observation.finalCallLogResult.answered &&
        live.ringcentral?.final_result_call_log_id === item.result_observation.callLogId;
      if (!alreadyHasResult || (item.repair_form_fill && live.form_fill !== true)) {
        conflicts.push({ lead_id: item.lead_id, reason: "revision_changed" }); continue;
      }
    }
    if (item.result_observation) await deps.persistResult(restoredObservation(item.result_observation), item.lead_id);
    await options.checkpoint?.("final_result", item.lead_id);
    await options.assertLease();
    await deps.reproject(item.lead_id);
    await options.checkpoint?.("projection_intent", item.lead_id);
    completed.push(item.lead_id);
  }
  return { completed, conflicts, unresolved: plan.items.filter(item => item.unresolved.length).map(item => ({ lead_id: item.lead_id, reasons: item.unresolved })), delivery_verified: false as const };
}

/** Read actual Sheet membership after draining; command/queue success is insufficient. */
export async function verifyCallBackfill(plan: CallBackfillPlan, options: {
  readMembership(leadId: string): Promise<{ calls: number; duplicate_calls: number; bad_call_leads: number }>;
}, overrides: Partial<CallBackfillDependencies> = {}) {
  const deps = { ...defaults(), ...overrides };
  await deps.connect();
  assertPlan(plan, plan.checksum, deps.database());
  const mismatches: Array<{ lead_id: string; reason: string }> = [];
  const plannedIds = new Set(plan.items.map(item => item.lead_id));
  if (plannedIds.size !== plan.items.length) mismatches.push({ lead_id: "", reason: "duplicate_planned_call_id" });
  const currentIds = new Set<string>();
  const from = new Date(CALL_BACKFILL_FROM), through = new Date(plan.through), padding = plan.timestamp_padding_ms;
  // Re-enumerate from saved facts with independent database reads. Never use a
  // provider lookup or the plan's own item list as proof that the cohort is complete.
  for (const scope of await deps.scopes()) for (const kind of ["primary", "boundary"] as const) {
    let cursor: Cursor | undefined;
    while (true) {
      const rows = await deps.page({ scope, kind, cursor, from, through, scanFrom: new Date(+from - padding), scanThrough: new Date(+through + padding), limit: 100 });
      if (!rows.length) break;
      for (const call of rows) {
        const id = String(call._id), arrival = instant(call.ringcentral?.start_time);
        if (arrival && (+arrival < +from || +arrival > +through)) continue;
        if (!arrival) {
          const exclusion = plan.coverage_exclusions?.find(item => item.lead_id === id);
          const excludedArrival = exclusion && instant(exclusion.arrival);
          const sameIdentity = exclusion && (exclusion.telephony_session_id && exclusion.telephony_session_id === call.ringcentral?.telephony_session_id ||
            exclusion.call_log_id && exclusion.call_log_id === call.ringcentral?.call_log_id);
          if (sameIdentity && excludedArrival && (+excludedArrival < +from || +excludedArrival > +through)) continue;
        }
        currentIds.add(id);
      }
      const last = rows.at(-1)!;
      const next = { timestamp: instant(last.timestamp)?.toISOString() ?? null, id: String(last._id) };
      if (cursor && JSON.stringify(cursor) === JSON.stringify(next)) throw new Error("Call backfill coverage cursor did not advance");
      cursor = next;
      if (rows.length < 100) break;
    }
  }
  for (const id of currentIds) if (!plannedIds.has(id)) mismatches.push({ lead_id: id, reason: "coverage_candidate_missing_from_plan" });
  for (const id of plannedIds) if (!currentIds.has(id)) mismatches.push({ lead_id: id, reason: "planned_candidate_outside_current_cohort" });
  const currentItems: CallBackfillItem[] = [];
  for (const item of plan.items) {
    const call = await deps.load(item.lead_id);
    if (!call) { mismatches.push({ lead_id: item.lead_id, reason: "canonical_call_missing" }); continue; }
    const decision = getCallLeadReportingDecision(call);
    const membership = await options.readMembership(item.lead_id);
    const expected = decision.disposition === "excluded" || (decision.disposition === "calls" && call.no_sync === true) ? null : decision.disposition;
    for (const tab of ["calls", "duplicate_calls", "bad_call_leads"] as const) {
      if (membership[tab] !== Number(tab === expected)) mismatches.push({ lead_id: item.lead_id, reason: `${tab}_physical_membership` });
    }
    if (decision.billable !== item.desired.billable || decision.disposition !== item.desired.disposition) mismatches.push({ lead_id: item.lead_id, reason: "canonical_disposition_drift" });
    currentItems.push({ ...item, desired: decision });
  }
  const unresolved = plan.items.filter(item => item.unresolved.length).map(item => ({ lead_id: item.lead_id, reasons: item.unresolved }));
  const readEvidence = overrides.queryEvidence ?? (overrides.page ? undefined : deps.queryEvidence);
  const queryEvidence = readEvidence ? await readEvidence() : { strategy: "injected_pages" as const, max_time_ms: 0, pages: 0, rows_returned: currentIds.size, explain_samples: [] };
  return { complete: mismatches.length === 0 && unresolved.length === 0, mismatches, unresolved,
    coverage: { planned: plannedIds.size, observed: currentIds.size, query_evidence: queryEvidence }, totals: callBackfillTotals(currentItems) };
}
