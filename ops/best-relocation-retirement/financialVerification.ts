import { connectMongo } from "../../src/db";
import { BookedLead } from "../../src/models/BookedLead";
import { CancelledLead } from "../../src/models/CancelledLead";
import { IngestionRun } from "../../src/models/IngestionRun";
import { SourceRowReceipt } from "../../src/models/SourceRowReceipt";
import { BEST_RELOCATION_COMPANY_SLUG, BEST_RELOCATION_RETIRED_LABELS } from "../../src/models/bestRelocationRetirement";
import type { BestRelocationPlanAction } from "../../src/services/bestRelocationSheetIngest/applicationPlan";
import type { RetirementSourcePlan } from "./sourcePlan";

type Row = Record<string, unknown>;
type FinancialModel = "BookedLead" | "CancelledLead";
type ReceiptIdentity = Pick<BestRelocationPlanAction, "dataset_key" | "stable_source_row_id" | "content_hash" | "schema_version">;
type Receipt = ReceiptIdentity & { outcome: string; resulting_canonical_model?: string | null; resulting_canonical_ids: string[] };
export type FinancialDiscrepancy = { reason: string; action_key?: string; model?: FinancialModel; id?: string; field?: string; expected_cents?: number; actual_cents?: number; count?: number };
export type FinancialVerificationDependencies = {
  connect(): Promise<void>;
  loadRun(id: string): Promise<Row | null>;
  loadReceipts(connectionId: string, identities: ReceiptIdentity[]): Promise<Receipt[]>;
  loadEntities(model: FinancialModel, ids: string[]): Promise<Row[]>;
};
export const FINANCIAL_VERIFICATION_ACTION_CAP = 10_000;
const BATCH_SIZE = 100;
const SUCCESS = new Set(["applied", "already_applied", "adopted"]);
const fields = (model: FinancialModel) => model === "BookedLead" ? ["total_binder_amount", "deposit_amount"] : ["refund_amount"];
const asRecord = (value: unknown): Row => value && typeof value === "object" ? value as Row : {};
const idOf = (value: unknown) => value == null ? "" : String(value);
const receiptKey = (value: ReceiptIdentity) => JSON.stringify([value.dataset_key, value.stable_source_row_id, value.schema_version, value.content_hash]);
const cents = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER / 100 ? Math.round(value * 100) : null;
const chunks = <T>(rows: T[]) => Array.from({ length: Math.ceil(rows.length / BATCH_SIZE) }, (_, index) => rows.slice(index * BATCH_SIZE, (index + 1) * BATCH_SIZE));

function defaults(): FinancialVerificationDependencies {
  return {
    connect: connectMongo,
    loadRun: async (id) => await IngestionRun.findById(id).select("connection_id plan_checksum status approval").lean() as Row | null,
    loadReceipts: async (connectionId, identities) => await SourceRowReceipt.find({ connection_id: connectionId, $or: identities.map(({ dataset_key, stable_source_row_id, content_hash, schema_version }) => ({ dataset_key, stable_source_row_id, content_hash, schema_version })) })
      .select("dataset_key stable_source_row_id content_hash schema_version outcome resulting_canonical_model resulting_canonical_ids").limit(BATCH_SIZE + 1).lean() as Receipt[],
    loadEntities: async (model, ids) => {
      const filter = { _id: { $in: ids } }, projection = "_id source total_binder_amount deposit_amount refund_amount booked_lead cancelled lead_ref";
      return model === "BookedLead"
        ? await BookedLead.find(filter).select(projection).limit(ids.length + 1).lean() as Row[]
        : await CancelledLead.find(filter).select(projection).limit(ids.length + 1).lean() as Row[];
    },
  };
}

/** Independent readback of canonical money and physical official outcome rows.
 * Receipts may predate this run because their evidence identity is append-only.
 * Nothing here repairs amounts or manufactures successful action outcomes. */
export async function verifyCanonicalFinancials(
  plan: RetirementSourcePlan, runId: string, connectionId: string,
  bookedMembership: Map<string, Map<string, number>>,
  overrides: Partial<FinancialVerificationDependencies> = {},
): Promise<{ complete: boolean; discrepancies: FinancialDiscrepancy[]; counters: Record<string, number> }> {
  const deps = { ...defaults(), ...overrides }, actions = plan.canonical_plan.actions;
  if (actions.length > FINANCIAL_VERIFICATION_ACTION_CAP) throw new Error("financial_verification_action_cap_exceeded");
  const discrepancies: FinancialDiscrepancy[] = [], counters: Record<string, number> = { canonical_actions: actions.length, financial_actions: 0, receipts_resolved: 0, bookings_checked: 0, cancellations_checked: 0, monetary_fields_verified: 0, expected_binder_cents: 0, canonical_binder_cents: 0, expected_deposit_cents: 0, canonical_deposit_cents: 0, expected_refund_cents: 0, canonical_refund_cents: 0 };
  const addCents = (key: string, amount: number) => {
    const total = counters[key] + amount;
    if (!Number.isSafeInteger(total)) throw new Error("financial_verification_money_total_overflow");
    counters[key] = total;
  };
  await deps.connect();
  const run = await deps.loadRun(runId);
  if (!run) discrepancies.push({ reason: "canonical_run_missing" });
  else {
    if (idOf(run.connection_id) !== connectionId || run.plan_checksum !== plan.checksum) discrepancies.push({ reason: "canonical_run_plan_or_connection_mismatch" });
    if (run.status !== "completed") discrepancies.push({ reason: "canonical_run_not_completed" });
    const stored = asRecord(asRecord(run.approval).apply_result), result = asRecord(stored.canonical ?? stored);
    const countKeys = ["applied", "already_applied", "conflicts", "failures", "skipped_dependencies", "completed_units"];
    if (countKeys.some((key) => !Number.isSafeInteger(result[key]) || Number(result[key]) < 0)) discrepancies.push({ reason: "canonical_apply_result_missing_or_invalid" });
    else {
      for (const key of countKeys) counters[`canonical_${key}`] = Number(result[key]);
      if (result.completed_units !== actions.length) discrepancies.push({ reason: "canonical_actions_not_all_completed" });
      for (const key of ["conflicts", "failures", "skipped_dependencies"]) if (Number(result[key])) discrepancies.push({ reason: `canonical_${key}`, count: Number(result[key]) });
    }
  }
  const intended = plan.financial_source_payloads ?? {};
  const financial = actions.filter((action) => action.dataset_key === "booked_deals" || action.dataset_key === "refunds" || Object.hasOwn(intended, action.action_key));
  counters.financial_actions = financial.length;
  const eligible = financial.filter((action) => {
    if (action.classification === "conflict" || action.classification === "invalid" || action.command === "record_conflict") {
      discrepancies.push({ reason: "financial_source_action_conflict", action_key: action.action_key }); return false;
    }
    if (!intended[action.action_key]) { discrepancies.push({ reason: "frozen_financial_payload_missing", action_key: action.action_key }); return false; }
    return true;
  });
  const identities = [...new Map(eligible.map((action) => [receiptKey(action), action])).values()];
  const receipts = new Map<string, Receipt[]>();
  for (const batch of chunks(identities)) {
    const rows = await deps.loadReceipts(connectionId, batch);
    if (rows.length > BATCH_SIZE) throw new Error("financial_verification_receipt_cap_exceeded");
    for (const row of rows) receipts.set(receiptKey(row), [...(receipts.get(receiptKey(row)) ?? []), row]);
  }
  const resolved: Array<{ action: BestRelocationPlanAction; model: FinancialModel; id: string; receipt: Receipt }> = [];
  const owned = new Map<string, string>();
  for (const action of eligible) {
    const model: FinancialModel = action.dataset_key === "refunds" ? "CancelledLead" : "BookedLead";
    const candidates = receipts.get(receiptKey(action)) ?? [];
    if (candidates.length !== 1) { discrepancies.push({ reason: candidates.length ? "ambiguous_financial_receipt" : "financial_receipt_missing", action_key: action.action_key, model }); continue; }
    const receipt = candidates[0], id = receipt.resulting_canonical_ids[0];
    if (!SUCCESS.has(receipt.outcome) || receipt.resulting_canonical_model !== model || !id) { discrepancies.push({ reason: "financial_receipt_not_successful", action_key: action.action_key, model }); continue; }
    // The receipt schema stores the primary model but all command entity IDs.
    // First ID is primary; subsequent IDs are linked Lead/Booking evidence.
    if (receipt.resulting_canonical_ids.length > 16) throw new Error("financial_verification_receipt_entity_cap_exceeded");
    const key = `${model}:${id}`;
    if (owned.has(key)) { discrepancies.push({ reason: "canonical_financial_entity_reused", action_key: action.action_key, model, id }); continue; }
    owned.set(key, action.action_key); resolved.push({ action, model, id, receipt }); counters.receipts_resolved++;
  }
  const entities = new Map<string, Row>();
  async function load(model: FinancialModel, ids: string[]) {
    const wanted = [...new Set(ids.filter((id) => id && !entities.has(`${model}:${id}`)))];
    if (wanted.length > FINANCIAL_VERIFICATION_ACTION_CAP * 2) throw new Error("financial_verification_entity_cap_exceeded");
    for (const batch of chunks(wanted)) {
      const rows = await deps.loadEntities(model, batch);
      if (rows.length > batch.length) throw new Error("financial_verification_entity_read_cap_exceeded");
      for (const row of rows) entities.set(`${model}:${idOf(row._id)}`, row);
    }
  }
  const prior = plan.target_before.filter((row) => row.model === "BookedLead" || row.model === "CancelledLead");
  if (prior.length > FINANCIAL_VERIFICATION_ACTION_CAP * 2) throw new Error("financial_verification_prior_entity_cap_exceeded");
  for (const model of ["BookedLead", "CancelledLead"] as const) await load(model, [...resolved.filter((item) => item.model === model).map((item) => item.id), ...prior.filter((row) => row.model === model).map((row) => idOf(row._id))]);
  await load("BookedLead", [...entities.entries()].filter(([key]) => key.startsWith("CancelledLead:")).map(([, row]) => idOf(row.booked_lead)));
  await load("CancelledLead", [...entities.entries()].filter(([key]) => key.startsWith("BookedLead:")).map(([, row]) => idOf(row.cancelled)));
  const checkedMembership = new Set<string>();
  function membership(model: FinancialModel, id: string) {
    const key = `${model}:${id}`;
    if (checkedMembership.has(key)) return;
    checkedMembership.add(key);
    const tab = model === "BookedLead" ? "Booked Deals" : "Cancelled Deals", count = bookedMembership.get(tab)?.get(id.toLowerCase()) ?? 0;
    if (count !== 1) discrepancies.push({ reason: "official_sheet_membership", model, id, count });
  }
  for (const [key, row] of entities) {
    const model = key.startsWith("BookedLead:") ? "BookedLead" : "CancelledLead", id = idOf(row._id);
    membership(model, id);
    if (model === "BookedLead" && row.cancelled) {
      const cancellationId = idOf(row.cancelled), cancellation = entities.get(`CancelledLead:${cancellationId}`);
      membership("CancelledLead", cancellationId);
      if (!cancellation || idOf(cancellation.booked_lead) !== id) discrepancies.push({ reason: "booking_cancellation_link_mismatch", model, id });
    } else if (model === "CancelledLead") {
      const bookingId = idOf(row.booked_lead), booking = entities.get(`BookedLead:${bookingId}`);
      membership("BookedLead", bookingId);
      if (!booking || idOf(booking.cancelled) !== id) discrepancies.push({ reason: "cancellation_booking_link_mismatch", model, id });
    }
  }
  function compare(model: FinancialModel, id: string, payload: Row, actionKey?: string, preservation = false) {
    const row = entities.get(`${model}:${id}`);
    if (!row) discrepancies.push({ reason: "canonical_financial_entity_missing", model, id, action_key: actionKey });
    for (const field of fields(model)) {
      const expected = cents(payload[field]), actual = cents(row?.[field]);
      if (expected === null || actual === null || expected !== actual) discrepancies.push({ reason: preservation ? "historical_financial_value_changed" : "frozen_financial_value_mismatch", model, id, field, action_key: actionKey, ...(expected === null ? {} : { expected_cents: expected }), ...(actual === null ? {} : { actual_cents: actual }) });
      else if (!preservation) counters.monetary_fields_verified++;
      if (!preservation) {
        const label = field === "total_binder_amount" ? "binder" : field === "deposit_amount" ? "deposit" : "refund";
        if (expected !== null) addCents(`expected_${label}_cents`, expected);
        if (actual !== null) addCents(`canonical_${label}_cents`, actual);
      }
    }
  }
  for (const item of resolved) {
    membership(item.model, item.id);
    compare(item.model, item.id, intended[item.action.action_key], item.action.action_key);
    const source=String(entities.get(`${item.model}:${item.id}`)?.source??"").trim().toLowerCase().replace(/\s+/g," ");
    if (source!==BEST_RELOCATION_COMPANY_SLUG && !BEST_RELOCATION_RETIRED_LABELS.some(label=>label===source)) discrepancies.push({ reason: "canonical_financial_source_mismatch", action_key: item.action.action_key, model: item.model, id: item.id });
    counters[item.model === "BookedLead" ? "bookings_checked" : "cancellations_checked"]++;
    const row = entities.get(`${item.model}:${item.id}`);
    if (row && item.model === "CancelledLead") {
      const payload = intended[item.action.action_key];
      const dependentBooking = resolved.find((candidate) => candidate.model === "BookedLead" && item.action.depends_on.includes(candidate.action.action_key));
      const literalBooking = typeof payload.booked_lead === "string" && !payload.booked_lead.startsWith("$ref:") ? payload.booked_lead : undefined;
      const expectedBooking = dependentBooking?.id ?? literalBooking;
      if (!expectedBooking || idOf(row.booked_lead) !== expectedBooking) discrepancies.push({ reason: "frozen_cancellation_booking_mismatch", action_key: item.action.action_key, model: item.model, id: item.id });
    }
    if (row && item.receipt.resulting_canonical_ids.length > 1) {
      const dependentId = idOf(item.model === "BookedLead" ? row.lead_ref : row.booked_lead);
      if (dependentId && !item.receipt.resulting_canonical_ids.slice(1).includes(dependentId)) discrepancies.push({ reason: "financial_receipt_dependency_mismatch", action_key: item.action.action_key, model: item.model, id: item.id });
    }
  }
  for (const row of prior) {
    const model = row.model as FinancialModel, id = idOf(row._id);
    compare(model, id, row, undefined, true); membership(model, id);
    if (model === "BookedLead" && row.cancelled && idOf(entities.get(`${model}:${id}`)?.cancelled) !== idOf(row.cancelled)) discrepancies.push({ reason: "historical_cancellation_link_changed", model, id });
  }
  for (const kind of ["binder", "deposit", "refund"]) counters[`${kind}_delta_cents`] = counters[`canonical_${kind}_cents`] - counters[`expected_${kind}_cents`];
  counters.discrepancies = discrepancies.length;
  return { complete: discrepancies.length === 0, discrepancies, counters };
}
