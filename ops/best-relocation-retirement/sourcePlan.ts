import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { ExternalDataConnection } from "../../src/models/ExternalDataConnection";
import { getCallLeadModel } from "../../src/models/CallLead";
import { getFormLeadModel } from "../../src/models/FormLead";
import { BookedLead } from "../../src/models/BookedLead";
import { CancelledLead } from "../../src/models/CancelledLead";
import { getLeadSourceCompanyModel } from "../../src/models/LeadSourceCompany";
import { getGranotCrmSourceModel } from "../../src/models/GranotCrmSource";
import { BEST_RELOCATION_RETIRED_LABELS } from "../../src/models/bestRelocationRetirement";
import { buildBestRelocationApplicationPlan, type BestRelocationApplicationPlan, type BestRelocationPlanAction } from "../../src/services/bestRelocationSheetIngest/applicationPlan";
import { applyCanonicalAdoptionPolicy } from "../../src/services/bestRelocationSheetIngest/canonicalLeadAdoption";
import { canonicalJson } from "../../src/services/durableWork";
import { loadSourceEvidence, preloadCanonicalAdoption, loadSourcePlanTargets, loadSourceCallCandidates, sourceIdentityKey } from "./sourcePlanCache";
import { stableSourceRowId, managedId, isValidManagedIngestionId, type AuthoritativeObservation } from "../../src/services/bestRelocationSheetIngest/identity";
import type { ParsedWorkbookData } from "../../src/services/bestRelocationSheetIngest/types";
import { selectBestRelocationRefundObservations } from "../../src/services/bestRelocationSheetIngest/matching";
import { hasQualifiedRingCentralCall } from "../../src/services/ringcentral/callLeadQualification";
import { classifyExternalReview, EXTERNAL_REVIEW_POLICY_VERSION } from "../../src/services/leads/externalSheetReview";
import type { CapturedReviewCell } from "../../src/services/domainCommands/externalSheetReview";
import { BEST_RELOCATION_CUTOFF } from "../../src/services/bestRelocationSheetIngest/sheets";
import { parseFrozenSnapshot, hash, type FrozenSourceSnapshot } from "./sourceSnapshot";

export type ReviewAction = { dataset_key: string; stable_source_row_id: string; cell: CapturedReviewCell;
  lead_model: "FormLead" | "CallLead"; lead_id?: string; lead_action_key?: string; expected_revision?: number;
  classification: string; conflict?: string; row: number; target_before?: unknown };
export type RetirementSourcePlan = { version: string; database: string; snapshot_hash: string; through: string; final_capture: boolean;
  connection_id: string | null; registry: { company_id: string; sources: unknown[] };
  inventory: ReturnType<typeof parseFrozenSnapshot>["inventory"]; canonical_plan: BestRelocationApplicationPlan;
  financial_source_payloads: Record<string, Record<string, unknown>>;
  review_actions: ReviewAction[]; counters: Record<string, number>; target_before: Array<Record<string, unknown>>; checksum: string };

export function retirementPlanChecksum(plan: RetirementSourcePlan): string { const { checksum: _checksum, ...data } = plan; return hash(data); }

const rowKey = (row: AuthoritativeObservation) => `${row.source_tab}:${row.sheet_row}`;
const datasetKey = (row: AuthoritativeObservation) => ({ Forms: "forms", "Local Forms": "local_forms", Calls: "calls", "Booked Deals": "booked_deals", Refunds: "refunds" })[row.source_tab];
/** Conflicting physical rows remain evidence; none may win by source order. */
export function partitionSourceIdentities(data: ParsedWorkbookData) {
  const rows = [...data.forms, ...data.localForms, ...data.calls,
    ...data.booked.filter(row => row.is_best_relocation_source),
    ...selectBestRelocationRefundObservations(data.refunds, data.booked)];
  const groups = new Map<string, AuthoritativeObservation[]>();
  const conflicts = new Map<string, { row: AuthoritativeObservation; stable_id: string; reason: "duplicate_source_identity" | "missing_durable_source_identity" }>();
  for (const row of rows) {
    try {
      if ((row.source_tab === "Calls" || row.source_tab === "Refunds") && !isValidManagedIngestionId(managedId(row.provenance.raw) ?? "")) throw new Error("invalid_managed_identity");
      const id = stableSourceRowId(row); groups.set(id, [...(groups.get(id) ?? []), row]);
    }
    catch { conflicts.set(rowKey(row), { row, stable_id: `unresolved:${hash([row.source_tab, row.sheet_row, row.provenance.raw])}`, reason: "missing_durable_source_identity" }); }
  }
  for (const [id, group] of groups) if (group.length > 1 && !group.every(row => row.source_tab === "Booked Deals")) {
    for (const row of group) conflicts.set(rowKey(row), { row, stable_id: id, reason: "duplicate_source_identity" });
  }
  const filtered = Object.fromEntries(["forms", "localForms", "calls", "booked", "refunds"].map(key => [key,
    (data[key as "forms"] as AuthoritativeObservation[]).filter(row => !conflicts.has(rowKey(row))),
  ]));
  return { data: { ...data, ...filtered } as ParsedWorkbookData, conflicts };
}

export function financialAdoptionMatches(model: string, payload: Record<string, unknown> | undefined, row: Record<string, unknown>): boolean {
  if (!["BookedLead", "CancelledLead"].includes(model)) return true;
  const source = typeof row.source === "string" ? row.source.trim().toLowerCase().replace(/\s+/g, " ") : "";
  if (!payload || !(source === "best_relocation_leads" || BEST_RELOCATION_RETIRED_LABELS.some(label => label === source))) return false;
  const fields = model === "BookedLead" ? ["total_binder_amount", "deposit_amount"] : ["refund_amount"];
  return fields.every(key => payload[key] == null ||
    Number.isFinite(Number(payload[key])) && Number.isFinite(Number(row[key])) &&
    Math.round(Number(payload[key]) * 100) === Math.round(Number(row[key]) * 100));
}
export function primaryReceiptReference(model: string | null | undefined, ids: readonly string[]) {
  if (!model || !["FormLead", "CallLead", "BookedLead", "CancelledLead"].includes(model) ||
      !ids.length || ids.length > 16 || ids.some(id => !mongoose.isValidObjectId(id)) ||
      (ids.length > 1 && !["BookedLead", "CancelledLead"].includes(model))) return null;
  return { primary: { model, id: ids[0]! }, related_ids: ids.slice(1) };
}
/** Receipt ownership wins; this final import never patches source-owned fields. */
export function applyFinalReceiptPolicy(plan: BestRelocationApplicationPlan, evidence: Awaited<ReturnType<typeof loadSourceEvidence>>) {
  const remapped = new Map<string, string>();
  const actions = plan.actions.map(action => {
    if (action.command === "record_conflict") return action;
    const key = sourceIdentityKey(action), latest = evidence.latest.get(key);
    if (!latest) return action;
    const baseline = evidence.canonical.get(key) ?? latest;
    const state = evidence.states.get(key);
    const ref = primaryReceiptReference(latest.resulting_canonical_model, latest.resulting_canonical_ids ?? []);
    const expectedModel = ({ forms: "FormLead", local_forms: "FormLead", calls: "CallLead", booked_deals: "BookedLead", refunds: "CancelledLead" } as Record<string, string>)[action.dataset_key];
    const priorValues = baseline.last_applied_source_values ?? state?.last_applied_source_values;
    const same = baseline.content_hash === action.content_hash || state?.last_applied_content_hash === action.content_hash || priorValues != null &&
      canonicalJson(priorValues) === canonicalJson(action.source_owned_values ?? action.command_payload ?? {});
    const actionKey = `${action.action_key}:revision:${action.content_hash.slice(0, 16)}`;
    remapped.set(action.action_key, actionKey);
    const { command_payload: _payload, ...rest } = action;
    return {
      ...rest, action_key: actionKey,
      command: ref?.primary.model === expectedModel && same ? "adopt_existing" as const : "record_conflict" as const,
      classification: ref?.primary.model === expectedModel && same ? "adoption" as const : "conflict" as const,
      ...(ref ? { adopted_entity_refs: [ref.primary, ...ref.related_ids.map(id => ({ model: ref.primary.model, id }))] } : {}),
      ...(!(ref?.primary.model === expectedModel && same) ? { conflict: { type: "canonical_divergence" as const, severity: "blocking" as const } } : {}),
    };
  });
  return { ...plan, actions: actions.map(action => ({ ...action, depends_on: action.depends_on.map(key => remapped.get(key) ?? key) })) };
}
export async function planSourceReconciliation(snapshot: FrozenSourceSnapshot): Promise<RetirementSourcePlan> {
  await connectMongo();
  if (mongoose.connection.name !== "vantagemovers") throw new Error("source_final_plan_requires_explicit_production_database");
  const { data, inventory } = parseFrozenSnapshot(snapshot);
  const partitioned = partitionSourceIdentities(data);
  const connection = await ExternalDataConnection.findOne({ key: "best_relocation" }).lean();
  const company = await getLeadSourceCompanyModel().findOne({ company_slug: "best_relocation_leads" }).select("_id company_slug granot_creation_retired_at").lean();
  if (!company) throw new Error("missing_best_relocation_company");
  const sources = await getGranotCrmSourceModel().find({ $or: [
    { lead_source_company: company._id }, { normalized_granot_label: { $in: BEST_RELOCATION_RETIRED_LABELS } },
  ] }).select("_id normalized_granot_label lead_source_company lead_created_policy lifecycle_policy_version lifecycle_routes outbound_sms granot_creation_retired_at").limit(50).lean();
  if (!sources.length || sources.length === 50) throw new Error("source_registry_inventory_incomplete");
  if (sources.some(source => source.lead_source_company && String(source.lead_source_company) !== String(company._id))) throw new Error("best_relocation_label_points_to_another_company");
  const callGranularities = [...new Set(sources.filter(source => ["bestrelocation inbounds", "best relocation inbounds"].includes(source.normalized_granot_label ?? ""))
    .flatMap(source => source.lifecycle_routes.filter(route => route.lead_model === "CallLead").map(route => String(route.source_granularity_id))))];
  // Different physical row order must not make later callbacks win the
  // existing earlier-only Form duplicate policy during this final import.
  for (const rows of [partitioned.data.forms, partitioned.data.localForms]) rows.sort((a,b) =>
    Date.parse(a.timestamp!) - Date.parse(b.timestamp!) || stableSourceRowId(a).localeCompare(stableSourceRowId(b)));
  const built = buildBestRelocationApplicationPlan({ data: partitioned.data, trigger: "manual", cutoff: BEST_RELOCATION_CUTOFF, sourceReadThrough: new Date(snapshot.through) });
  const originalPayloads = new Map(built.plan.actions.map(action => [`${action.dataset_key}:${action.stable_source_row_id}`, action.command_payload]));
  const identities = [...built.plan.actions.map(action => ({ dataset_key: action.dataset_key, stable_source_row_id: action.stable_source_row_id })),
    ...[...partitioned.data.forms, ...partitioned.data.localForms, ...partitioned.data.calls].map(row => ({ dataset_key: datasetKey(row), stable_source_row_id: stableSourceRowId(row) }))];
  const evidence = await loadSourceEvidence(connection ? String(connection._id) : null, identities);
  const receiptPlan = applyFinalReceiptPolicy(built.plan, evidence);
  const receiptBookings = [...evidence.latest.values()].filter(row => row.resulting_canonical_model === "BookedLead").flatMap(row => row.resulting_canonical_ids.slice(0, 1));
  const adoptionStore = await preloadCanonicalAdoption(receiptPlan, receiptBookings);
  let canonical = await applyCanonicalAdoptionPolicy({ plan: receiptPlan, store: adoptionStore });
  const refs = [...canonical.actions.flatMap(action => action.adopted_entity_refs ?? []), ...[...evidence.latest.values()].flatMap(row =>
    row.resulting_canonical_ids?.length && row.resulting_canonical_model ? [{ model: row.resulting_canonical_model, id: row.resulting_canonical_ids[0] }] : [])];
  const targets = await loadSourcePlanTargets(refs);
  const callCandidates = await loadSourceCallCandidates(partitioned.data.calls.filter(row => !evidence.latest.has(`calls:${stableSourceRowId(row)}`)), String(company._id), callGranularities);
  for (const candidate of callCandidates) targets.set(`CallLead:${candidate._id}`, candidate);
  const targetBefore: Array<Record<string, unknown>> = [];
  for (const action of canonical.actions) {
    let receiptRelatedIds: string[] = [];
    if (action.command === "update_source_owned_lead") {
      // Generic historical ingestion updates lack an expected-revision CAS.
      // The final review fact can still reconcile independently via receipts.
      action.command = "record_conflict"; action.classification = "conflict";
      action.conflict = { type: "canonical_divergence", severity: "blocking" };
    }
    if (action.command === "unchanged" && connection) {
      const receipt = evidence.latest.get(sourceIdentityKey(action));
      const reference = receipt && primaryReceiptReference(receipt.resulting_canonical_model, receipt.resulting_canonical_ids);
      if (reference) {
        action.command = "adopt_existing"; action.classification = "adoption";
        action.adopted_entity_refs = [reference.primary];
        receiptRelatedIds = reference.related_ids;
      } else { action.command = "record_conflict"; action.classification = "conflict"; action.conflict = { type: "canonical_divergence", severity: "blocking" }; }
    }
    const refs = action.adopted_entity_refs;
    if (refs && refs.length > 1 && refs.every(ref => ref.model === refs[0]!.model)) {
      // Old receipts store one primary model alongside IDs of linked entities.
      // A linked Lead ID must never be loaded as a second BookedLead.
      const reference = primaryReceiptReference(refs[0]!.model, refs.map(ref => ref.id));
      if (reference) { receiptRelatedIds = reference.related_ids; action.adopted_entity_refs = [reference.primary]; }
      else { action.command = "record_conflict"; action.classification = "conflict"; action.conflict = { type: "canonical_divergence", severity: "blocking" }; action.adopted_entity_refs = []; }
    }
    for (const ref of action.adopted_entity_refs ?? []) {
      const row = targets.get(`${ref.model}:${ref.id}`);
      if (!row) { action.command = "record_conflict"; action.classification = "conflict"; action.conflict = { type: "canonical_divergence", severity: "blocking" }; continue; }
      targetBefore.push({ model: ref.model, ...row });
      const payload = originalPayloads.get(`${action.dataset_key}:${action.stable_source_row_id}`);
      const linkedIds = [row.lead_ref, row.booked_lead, row.booked].filter(Boolean).map(String);
      if (receiptRelatedIds.some(id => !linkedIds.includes(id)) ||
          (["FormLead", "CallLead"].includes(ref.model) && row.source_company !== "best_relocation_leads") || !financialAdoptionMatches(ref.model, payload, row)) {
        action.command = "record_conflict"; action.classification = "conflict"; action.conflict = { type: "canonical_divergence", severity: "blocking" };
      }
    }
    if (action.command === "create_form_lead" && action.command_payload) Object.assign(action.command_payload, { post_to_granot: false, sms_consent: false });
  }
  for (const entry of partitioned.conflicts.values()) {
    const action: BestRelocationPlanAction = {
      action_key: `retirement-conflict:${hash([snapshot.through, rowKey(entry.row), entry.stable_id, entry.reason])}`,
      command: "record_conflict", classification: "conflict", dataset_key: datasetKey(entry.row),
      stable_source_row_id: entry.stable_id, content_hash: hash([EXTERNAL_REVIEW_POLICY_VERSION, entry.row.provenance.raw]),
      schema_profile: `${datasetKey(entry.row)}:v2`, schema_version: 2, provenance: entry.row.provenance, depends_on: [],
      conflict: { type: entry.reason === "duplicate_source_identity" ? "duplicate_source_identity" : "schema_drift", severity: "blocking" },
    };
    canonical.actions.push(action);
  }
  canonical.counters = canonical.actions.reduce<Record<string, number>>((counts, action) => { counts[action.classification] = (counts[action.classification] ?? 0) + 1; return counts; }, {});
  const financialSourcePayloads = Object.fromEntries(canonical.actions
    .filter(action => ["booked_deals", "refunds"].includes(action.dataset_key) && originalPayloads.get(`${action.dataset_key}:${action.stable_source_row_id}`) != null)
    .map(action => [action.action_key, originalPayloads.get(`${action.dataset_key}:${action.stable_source_row_id}`)!]));
  const reviews: ReviewAction[] = [];
  for (const row of [...data.forms, ...data.localForms, ...data.calls]) {
    const isCall = row.kind === "call", model = isCall ? "CallLead" : "FormLead";
    const dataset = row.source_tab === "Local Forms" ? "local_forms" : isCall ? "calls" : "forms";
    const identityConflict = partitioned.conflicts.get(rowKey(row));
    const stable = identityConflict?.stable_id ?? stableSourceRowId(row), raw = row.provenance.raw[isCall ? "Form Fill Checker" : "Bad Lead Checker"] ?? (isCall ? row.form_fill_checker : row.bad_lead_checker);
    const tab = snapshot.tabs.find(t => t.tabName === row.source_tab)!;
    const cell: CapturedReviewCell = { source_workbook_id: tab.spreadsheetId, source_sheet_id: tab.tabId!, source_tab: row.source_tab,
      stable_source_row_id: stable, raw_value: raw, source_content_hash: hash([EXTERNAL_REVIEW_POLICY_VERSION, row.provenance.raw]) };
    const review: ReviewAction = { dataset_key: dataset, stable_source_row_id: stable, cell, lead_model: model, classification: "unchanged", row: row.sheet_row };
    if (identityConflict) { review.classification = "conflict"; review.conflict = identityConflict.reason; reviews.push(review); continue; }
    try { review.classification = classifyExternalReview(raw, model)?.kind ?? "unchanged"; }
    catch (error) { review.classification = "conflict"; review.conflict = error instanceof Error ? error.message : "review_invalid"; }
    const action = canonical.actions.find(a => a.dataset_key === dataset && a.stable_source_row_id === stable);
    let ids = action?.adopted_entity_refs?.filter(r => r.model === model).map(r => r.id) ?? [];
    if (connection) {
      const receipt = evidence.latest.get(`${dataset}:${stable}`);
      if (receipt?.resulting_canonical_model === model) ids = receipt.resulting_canonical_ids;
    }
    if (isCall && !ids.length && row.normalized_phone && row.timestamp && callGranularities.length) {
      const at = Date.parse(row.timestamp);
      const matches = callCandidates.filter(candidate => candidate.normalized_phone_number === row.normalized_phone &&
        candidate.ringcentral?.start_time instanceof Date && Math.abs(+candidate.ringcentral.start_time - at) <= 1000);
      ids = matches.filter(candidate => hasQualifiedRingCentralCall(candidate.ringcentral) && candidate.created_on_unmatched !== true).map(candidate => String(candidate._id));
    }
    if (ids.length === 1) {
      const target = targets.get(`${model}:${ids[0]}`);
      if (!target || target.source_company !== "best_relocation_leads" || (isCall && (!hasQualifiedRingCentralCall(target.ringcentral) || target.created_on_unmatched))) {
        review.classification = "conflict"; review.conflict = "unqualified_or_wrong_source_target";
      } else { review.lead_id = ids[0]; review.expected_revision = Number(target.domain_revision ?? 0); review.target_before = target; }
    } else if (!isCall && action?.command === "create_form_lead") review.lead_action_key = action.action_key;
    else { review.classification = "conflict"; review.conflict = ids.length > 1 ? "ambiguous_canonical_match" : isCall ? "no_qualified_ringcentral_call_match" : "unresolved_form_dependency"; }
    reviews.push(review);
  }
  const counters: Record<string, number> = {};
  for (const review of reviews) { const key = `${review.dataset_key}:${review.conflict ?? review.classification}`; counters[key] = (counters[key] ?? 0) + 1; }
  for (const review of reviews) {
    try {
      const requested = classifyExternalReview(review.cell.raw_value, review.lead_model);
      if (!requested) continue;
      const key = `requested:${requested.kind}`; counters[key] = (counters[key] ?? 0) + 1;
      if (review.conflict) { const gap = `unprojectable_requested:${requested.kind}`; counters[gap] = (counters[gap] ?? 0) + 1; }
      const before = review.target_before as {form_fill?:boolean; duplicate?:boolean} | undefined;
      if (requested.kind === "bad_call" && before?.form_fill) counters.call_bad_and_form_fill_overlap = (counters.call_bad_and_form_fill_overlap ?? 0) + 1;
      if (requested.kind === "bad_call" && before?.duplicate) counters.call_bad_and_repeat_duplicate_overlap = (counters.call_bad_and_repeat_duplicate_overlap ?? 0) + 1;
    } catch { counters.invalid_review_annotations = (counters.invalid_review_annotations ?? 0) + 1; }
  }
  const plan: RetirementSourcePlan = { version: EXTERNAL_REVIEW_POLICY_VERSION, database: mongoose.connection.name, snapshot_hash: hash(snapshot), through: snapshot.through,
    final_capture: snapshot.final_capture, connection_id: connection ? String(connection._id) : null, registry: { company_id: String(company._id), sources },
    inventory, canonical_plan: canonical, financial_source_payloads: financialSourcePayloads,
    review_actions: reviews, counters, target_before: targetBefore, checksum: "" };
  plan.checksum = retirementPlanChecksum(plan);
  return plan;
}
