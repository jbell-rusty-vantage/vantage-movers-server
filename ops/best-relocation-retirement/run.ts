import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getMasterLeadsSheetContainerId, getMasterBookedSheetContainerId, shouldWriteSourceLeadSheets, getSourceLeadSheetContainerId, SOURCE_COMPANIES, getMongoDatabaseName } from "../../src/config/domain";
import { ExternalDataConnection } from "../../src/models/ExternalDataConnection";
import { IngestionRun } from "../../src/models/IngestionRun";
import { SourceRowReceipt } from "../../src/models/SourceRowReceipt";
import { SheetSyncLease } from "../../src/models/SheetSyncLease";
import { getEntityChangeModel } from "../../src/models/EntityChange";
import { getCallLeadModel } from "../../src/models/CallLead";
import { getFormLeadModel } from "../../src/models/FormLead";
import { BookedLead } from "../../src/models/BookedLead";
import { CancelledLead } from "../../src/models/CancelledLead";
import { DomainCommandExecution } from "../../src/models/DomainCommandExecution";
import { getLeadSourceCompanyModel } from "../../src/models/LeadSourceCompany";
import { getGranotCrmSourceModel } from "../../src/models/GranotCrmSource";
import { MongoLeaseStore, computeChecksum, type DurableActor, type LeaseToken } from "../../src/services/durableWork";
import { canonicalDomainCommands } from "../../src/services/domainCommands";
import { reconcileExternalSheetReview, reviewPayloadChecksum } from "../../src/services/domainCommands/externalSheetReview";
import { applyBestRelocationPlan } from "../../src/services/ingestion/applyPlan";
import { appendSourceReceipt } from "../../src/services/ingestion/repository";
import { retireBestRelocationConnectionAndSources } from "../../src/services/ingestion/retireBestRelocation";
import { getSheetsClient } from "../../src/services/googleSheets/auth";
import { planExpectedSheetTabs } from "../../src/services/googleSheets/expectedSheetTabs";
import { inspectLeadTabMigration, applyLeadTabMigration } from "../../src/services/googleSheets/tabMigration";
import { syncSourceLeadById, syncBookedLeadById, syncCancellationChainById } from "../../src/services/sheetSync/sheetSyncSourceLookup";
import { runSheetSyncDrain } from "../../src/services/sheetSync/drainer";
import { enqueueSheetSyncJob } from "../../src/services/sheetSync/sheetSyncOutbox.service";
import { withRuntimeDomainOverrides } from "../../src/config/domain/runtime";
import { BEST_RELOCATION_CUTOFF } from "../../src/services/bestRelocationSheetIngest/sheets";
import { EXTERNAL_REVIEW_POLICY_VERSION } from "../../src/services/leads/externalSheetReview";
import { captureSourceSnapshot, hash, type FrozenSourceSnapshot } from "./sourceSnapshot";
import { inspectDerivativeFormulas, applyDerivativeFormulas, type DerivativeFormulaPlan } from "./derivativeFormulas";
import { verifyCanonicalFinancials } from "./financialVerification";
import { planSourceReconciliation, retirementPlanChecksum, type RetirementSourcePlan } from "./sourcePlan";
import { planCallBackfill, applyCallBackfill, verifyCallBackfill, callBackfillPlanChecksum, type CallBackfillPlan } from "./callBackfill";
import { assertProductionWriterMatchesDeployment } from "../lib/production-writer-guard";
import { applyGeneralCallRun, verifyGeneralCallRun } from "./generalCallRun";
import { shutdownBestRelocationWithoutIngestion } from "./shutdown";
import { BEST_RELOCATION_ADMISSION_CALL_FEED_ID, BEST_RELOCATION_ADMISSION_COMPANY_ID } from "../../src/services/leads/callLeadAdmission";

const args = process.argv.slice(2), mode = args[0] && !args[0].startsWith("--") ? args.shift()! : "inspect";
const option = (key: string) => { const at = args.indexOf(`--${key}`); return at < 0 ? undefined : args[at + 1]; };
const required = (key: string) => { const value = option(key); if (!value || value.startsWith("--")) throw new Error(`missing_${key}`); return value; };
const has = (key: string) => args.includes(`--${key}`);
const output = path.resolve(option("output-dir") ?? "scripts/output/best-relocation-retirement");
const owner: DurableActor = { actor_type: "owner", actor_role: "owner", actor_id: "owner-authorized-lead-reporting-retirement",
  actor_label: "Owner-authorized lead reporting and Best Relocation retirement", origin: "vantage_admin", request_id: randomUUID() };
const actor: DurableActor = { actor_type: "system", actor_role: "system", actor_id: "best-relocation-ingestion",
  actor_label: "Best Relocation final reconciliation", origin: "external_sheet_ingestion", request_id: owner.request_id };
const load = async <T>(file: string): Promise<T> => JSON.parse(await readFile(path.resolve(file), "utf8")) as T;
const save = async (file: string, value: unknown) => { await mkdir(output, { recursive: true }); await writeFile(path.join(output, file), JSON.stringify(value, null, 2), { mode: 0o600 }); };
const summary = (value: unknown) => console.log(JSON.stringify(value));

async function database() {
  await connectMongo();
  if (mongoose.connection.name !== "vantagemovers" || getMongoDatabaseName() !== "vantagemovers") throw new Error("expected_production_database_mismatch");
}
async function assertDeployment(commit: string) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("full_deployment_commit_required");
  await database();
  const stamp = await mongoose.connection.db!.collection("sales_intelligence_sync_state").findOne({ scope: "deployment" });
  if (stamp?.deployment_commit !== commit || !(stamp.recorded_at instanceof Date) || Date.now() - +stamp.recorded_at > 30 * 60000 ||
      !["VERCEL_GIT_COMMIT_SHA", "DEPLOYMENT_COMMIT_SHA"].includes(String(stamp.commit_source)) ||
      typeof stamp.vercel_deployment_id !== "string" || !/^dpl_[A-Za-z0-9]+$/.test(stamp.vercel_deployment_id)) throw new Error("fresh_production_deployment_proof_missing");
  await assertProductionWriterMatchesDeployment({ argv: [],
    localHead: () => execFileSync("git", ["-C", path.resolve(__dirname, "../.."), "rev-parse", "HEAD"], {encoding:"utf8"}).trim(),
  });
}

function assertCallPlanWatermark(plan: RetirementSourcePlan, calls: CallBackfillPlan) {
  if (calls.through !== plan.through || calls.database !== plan.database) throw new Error("call_plan_source_watermark_or_database_mismatch");
}
async function assertAppliedCallPlan(plan: RetirementSourcePlan, calls: CallBackfillPlan, runId: string) {
  assertCallPlanWatermark(plan, calls);
  const run = await IngestionRun.findById(runId).select("plan_checksum approval").lean();
  const binding = (run?.approval as {call_plan?: {checksum:string;source_checksum:string;snapshot_hash:string;through:string;deployment_id:string;applied:boolean}} | undefined)?.call_plan;
  if (run?.plan_checksum !== plan.checksum || !binding?.applied || binding.checksum !== calls.checksum || binding.source_checksum !== plan.checksum ||
      binding.snapshot_hash !== plan.snapshot_hash || binding.through !== calls.through || binding.deployment_id !== calls.deployment_id) throw new Error("post_source_call_plan_approval_missing_or_mismatched");
}
async function withLease<T>(scope: string, runId: string, operation: (lease: () => LeaseToken, assert: () => Promise<void>) => Promise<T>): Promise<T> {
  const store = new MongoLeaseStore(SheetSyncLease);
  let lease = await store.acquire({ scope, owner: runId, ttl_ms: 300000, now: new Date() });
  if (!lease) throw new Error("operator_lease_held");
  let failure: unknown, renewal = Promise.resolve();
  const assert = () => {
    renewal = renewal.then(async () => {
      if (failure) throw failure;
      const next = await store.renew({ token: lease!, ttl_ms: 300000, now: new Date() });
      if (!next) throw new Error("operator_lease_lost"); lease = next;
    });
    return renewal;
  };
  const heartbeat = setInterval(() => { void assert().catch(error => { failure = error; }); }, 30000);
  heartbeat.unref();
  try { return await operation(() => lease!, assert); }
  finally { clearInterval(heartbeat); await renewal.catch(() => {}); await store.release({ token: lease, now: new Date() }); }
}

type Membership = Map<string, Map<string, number>>;
async function readMemberships(): Promise<{ leads: Membership; booked: Membership; tabs: unknown[] }> {
  const sheets = getSheetsClient(), leads: Membership = new Map(), booked: Membership = new Map(), tabs: unknown[] = [];
  for (const [id, map] of [[getMasterLeadsSheetContainerId(), leads], [getMasterBookedSheetContainerId(), booked]] as const) {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: id, fields: "sheets.properties(sheetId,title,gridProperties)" });
    for (const sheet of meta.data.sheets ?? []) {
      const title = sheet.properties?.title!;
      if (!["Forms", "Calls", "Duplicate Forms", "Duplicates", "Bad Form Leads", "Bad Leads", "Duplicate Calls", "Bad Call Leads", "Booked Deals", "Cancelled Deals"].includes(title)) continue;
      const rowCount = sheet.properties?.gridProperties?.rowCount ?? 0;
      if (rowCount > 100000) throw new Error("destination_grid_exceeds_reviewed_verify_bound");
      const header = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `'${title}'!A1:ZZ1` });
      const headers = header.data.values?.[0] ?? [], index = headers.indexOf("Mongo ID");
      if (index < 0) throw new Error(`destination_mongo_id_header_missing:${title}`);
      const column = index < 26 ? String.fromCharCode(65 + index) : `${String.fromCharCode(64 + Math.floor(index / 26))}${String.fromCharCode(65 + index % 26)}`;
      const counts = new Map<string, number>();
      for (let start = 2; start <= rowCount; start += 5000) {
        const page = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `'${title}'!${column}${start}:${column}${Math.min(start + 4999, rowCount)}` });
        for (const row of page.data.values ?? []) { const value = String(row[0] ?? "").trim().toLowerCase(); if (value) counts.set(value, (counts.get(value) ?? 0) + 1); }
      }
      map.set(title, counts); tabs.push({ workbook: id, title, sheet_id: sheet.properties?.sheetId, rows: [...counts.values()].reduce((a,b) => a+b,0), duplicate_ids: [...counts.values()].filter(n => n > 1).length });
    }
  }
  return { leads, booked, tabs };
}
function serializedMemberships(value: Awaited<ReturnType<typeof readMemberships>>) {
  return { leads: Object.fromEntries([...value.leads].map(([tab, ids]) => [tab, Object.fromEntries(ids)])), booked: Object.fromEntries([...value.booked].map(([tab, ids]) => [tab, Object.fromEntries(ids)])), tabs: value.tabs };
}
async function resolvedReviews(plan: RetirementSourcePlan, connectionId: string) {
  const resolved = [];
  for (const action of plan.review_actions) {
    let id = action.lead_id;
    if (!id && action.lead_action_key) {
      const receipt = await SourceRowReceipt.findOne({ connection_id: connectionId, dataset_key: action.dataset_key,
        stable_source_row_id: action.stable_source_row_id, resulting_canonical_model: action.lead_model,
        outcome: { $in: ["applied", "already_applied", "adopted"] } }).sort({ createdAt: -1 }).select("resulting_canonical_ids").lean();
      if (receipt?.resulting_canonical_ids.length === 1) id = receipt.resulting_canonical_ids[0];
    }
    resolved.push({ ...action, ...(id ? { lead_id: id } : {}) });
  }
  return resolved;
}

async function apply(plan: RetirementSourcePlan, runId: string) {
  if (!plan.final_capture || retirementPlanChecksum(plan) !== required("checksum") || plan.checksum !== required("checksum")) throw new Error("final_frozen_plan_checksum_required");
  if (!has("owner-release-ingestion-hold")) throw new Error("BEST_RELOCATION_INGESTION_HELD_BY_OWNER");
  if (!Array.isArray(plan.new_normal_call_flags)) throw new Error("owner_corrected_final_source_plan_required");
  if (plan.booking_graph?.version !== "best-relocation-booking-bounded-v1" || !Array.isArray(plan.booking_matches) || !Array.isArray(plan.skipped_source_rows)) throw new Error("booking_bounded_final_plan_required");
  if (required("expected-database") !== "vantagemovers") throw new Error("explicit_database_mismatch");
  await assertDeployment(required("deployment"));
  const before = await readMemberships(); await save(`${runId}-membership-before.json`, serializedMemberships(before));
  return withLease("ingestion:best_relocation:apply", runId, async (lease, assertLease) => {
    let connection = await ExternalDataConnection.findOne({ key: "best_relocation" }).lean();
    if (connection?.retired_at) throw new Error("final_import_already_retired_requires_scoped_correction");
    if (!connection) connection = (await ExternalDataConnection.create({ key: "best_relocation", provider: "google_sheets", application_enabled: false,
      created_actor: owner, updated_actor: owner, workbook_env_keys: { leads: "archived_final_snapshot", booked: "archived_final_snapshot" } })).toObject();
    const connectionId = String(connection._id);
    await ExternalDataConnection.updateOne({ _id: connection._id, retired_at: null }, { $set: { application_enabled: false, next_due_at: null } });
    const canonicalChecksum = computeChecksum({ checksum_version: 1, artifact_kind: "ingestion_plan", schema_version: plan.canonical_plan.schema_version, payload: plan.canonical_plan });
    const existingRun = await IngestionRun.findById(runId).lean();
    if (existingRun && existingRun.plan_checksum !== plan.checksum) throw new Error("resume_plan_checksum_mismatch");
    await IngestionRun.updateOne({ _id: runId }, { $set: { adapter_key: "best_relocation", schema_version: 3, trigger: "manual", status: "applying", connection_id: connection._id,
      cutoff: BEST_RELOCATION_CUTOFF, timezone: "America/New_York", source_read_through: new Date(plan.through), plan_snapshot: plan,
      plan_checksum: plan.checksum, plan_locked_at: new Date(), source_snapshot: { hash: plan.snapshot_hash }, actor, initiator: owner,
      "approval.final_reconciliation": true, "approval.policy_version": EXTERNAL_REVIEW_POLICY_VERSION, lease_owner: lease().owner, lease_epoch: lease().epoch, leased_until: lease().leased_until,
      "approval.owner_released_deferred_ingestion_checksum":plan.checksum,
      ...(has("approve-normal-call-inserts") ? { "approval.normal_call_insert_approval": plan.checksum } : {}),
    } }, { upsert: true });
    const assertEnabled = async () => {
      await assertLease();
      if (!await ExternalDataConnection.exists({ _id: connection!._id, retired_at: null })) throw new Error("final_import_retired");
      await IngestionRun.updateOne({ _id: runId, plan_checksum: plan.checksum }, { $set: { lease_owner: lease().owner, lease_epoch: lease().epoch, leased_until: lease().leased_until } });
    };
    const canonical = await applyBestRelocationPlan({ plan: plan.canonical_plan, checksum: canonicalChecksum, run_id: runId, connection_id: connectionId, actor, initiator: owner,
      lease: lease(), leaseStore: new MongoLeaseStore(SheetSyncLease), commands: canonicalDomainCommands,
      final_reconciliation: { run_id: runId, plan_checksum: canonicalChecksum }, assertApplicationEnabled: assertEnabled,
      onCheckpoint: async checkpoint => { await save(`${runId}-canonical-checkpoint.json`, checkpoint); },
    });
    const reviews = await resolvedReviews(plan, connectionId), outcomes: Array<Record<string, unknown>> = [];
    for (const action of reviews) {
      await assertEnabled();
      if (action.conflict || !action.lead_id) { outcomes.push({ stable_id: action.stable_source_row_id, outcome: "conflict", reason: action.conflict ?? "dependency_failed" }); continue; }
      const Model = (action.lead_model === "FormLead" ? getFormLeadModel() : getCallLeadModel()) as mongoose.Model<any>;
      const current = await Model.findById(action.lead_id).select("domain_revision external_sheet_review").lean();
      if (!current) throw new Error("review_target_disappeared");
      const receiptId = new mongoose.Types.ObjectId(hash([runId, action.dataset_key, action.stable_source_row_id, action.cell.source_content_hash]).slice(0,24)).toHexString();
      const envelopeKey = hash([action.dataset_key, action.stable_source_row_id, action.cell.source_content_hash]);
      const stored = await IngestionRun.findById(runId).select(`approval.review_envelopes.${envelopeKey}`).lean();
      let payload = (stored?.approval as {review_envelopes?: Record<string, {lead_model: "FormLead"|"CallLead"; lead_id:string; expected_revision:number; cell: typeof action.cell}>} | undefined)?.review_envelopes?.[envelopeKey];
      if (!payload) {
        // Only mutations committed by this frozen canonical run may advance
        // the planned revision before review. Concurrent owner edits still fail.
        const ownChanges = await getEntityChangeModel().countDocuments({ "entity.model": action.lead_model, "entity.id": action.lead_id,
          "provenance.run_id": runId, command_name: { $ne: "reconcileExternalSheetReviewV1" } });
        payload = { lead_model: action.lead_model, lead_id: action.lead_id,
          expected_revision: (action.expected_revision ?? 0) + ownChanges, cell: action.cell };
        await IngestionRun.updateOne({ _id: runId, plan_checksum: plan.checksum }, { $set: { [`approval.review_envelopes.${envelopeKey}`]: payload } });
      }
      const checksum = reviewPayloadChecksum(payload);
      const result = await reconcileExternalSheetReview({ ...payload, execution: { lease: lease() }, context: {
        command_id: receiptId, idempotency_key: `retirement-review:${checksum}`, payload_checksum: checksum, actor, initiator: owner,
        provenance: { origin: "external_sheet_ingestion", run_id: runId, source_receipt_id: receiptId, source_connection_key: "best_relocation" },
      } });
      await appendSourceReceipt({ _id: receiptId, connection_id: connectionId, dataset_key: action.dataset_key, stable_source_row_id: action.stable_source_row_id,
        content_hash: action.cell.source_content_hash, schema_profile: EXTERNAL_REVIEW_POLICY_VERSION, schema_version: 3, workbook_id: action.cell.source_workbook_id,
        workbook_title: "BestRelocation Lead Tracker (Vantage Movers)", tab_id: action.cell.source_sheet_id, tab_name: action.cell.source_tab,
        last_observed_row_number: action.row, range: `${action.cell.source_tab}:frozen`, observed_at: new Date(plan.through), ingestion_run_id: runId,
        observation_type: "final_review", classification: action.classification, outcome: (result.status === "already_applied") ? "already_applied" : "applied",
        resulting_canonical_model: action.lead_model, resulting_canonical_ids: [action.lead_id], source_state: "present" });
      await enqueueSheetSyncJob({ resource: "source_lead", operation: action.lead_model === "FormLead" ? "form_lead.update" : "call_lead.update", leadModel: action.lead_model, leadId: action.lead_id }, {createdBy: "script"});
      outcomes.push({ stable_id: action.stable_source_row_id, id: action.lead_id, outcome: (result.status === "already_applied") ? "replayed" : "reconciled" });
      await save(`${runId}-review-checkpoint.json`, outcomes);
    }
    // The general Call plan is captured explicitly AFTER source creates/reviews.
    // It has its own checksum; an earlier plan must never be silently retargeted.
    const calls = { completed: [], conflicts: [], phase: "awaiting_post_source_plan" };
    // Exact replay emits no new intent. Reproject each resolved financial aggregate independently.
    const receipts = await SourceRowReceipt.find({ ingestion_run_id: runId, resulting_canonical_model: { $in: ["BookedLead", "CancelledLead"] } }).select("resulting_canonical_model resulting_canonical_ids").limit(1001).lean();
    if (receipts.length > 1000) throw new Error("financial_reprojection_bound_exceeded_requires_paging");
    for (const receipt of receipts) for (const id of receipt.resulting_canonical_ids.slice(0, 1)) {
      await assertEnabled();
      await enqueueSheetSyncJob(receipt.resulting_canonical_model === "BookedLead"
        ? { resource: "booked_lead", operation: "booked_lead.update", bookingId: id }
        : { resource: "cancellation_chain", operation: "cancelled_lead.update", cancellationId: id }, {createdBy: "script"});
    }
    const result = { run_id: runId, canonical, reviews: outcomes, calls };
    await save(`${runId}-apply-result.json`, result);
    await assertEnabled();
    const finished = await IngestionRun.updateOne({ _id: runId, plan_checksum:plan.checksum, status:"applying", lease_owner:lease().owner, lease_epoch:lease().epoch }, { $set: { status: canonical.failures || canonical.conflicts || outcomes.some(o=>o.outcome === "conflict") ? "completed_with_errors" : "completed", completed_at: new Date(), "approval.apply_result": canonical } });
    if (finished.matchedCount !== 1) throw new Error("source_run_finalize_fence_lost");
    return result;
  });
}

async function sourceEvidence(plan: RetirementSourcePlan, runId: string) {
  await database();
  const connection = await ExternalDataConnection.findOne({ key: "best_relocation" }).lean();
  const company = await getLeadSourceCompanyModel().findById(plan.registry.company_id).select("_id active granot_creation_retired_at").lean();
  const sources = await getGranotCrmSourceModel().find({ _id: { $in: plan.registry.sources.map(row => String((row as {_id:unknown})._id)) } })
    .select("_id lead_created_policy enabled lifecycle_routes outbound_sms").lean();
  const projection = "_id domain_revision duplicate form_fill external_sheet_review external_call_admission outreach_automation_suppressed booked cancelled job_no normalized_job_no lead_ref lead_model total_binder_amount deposit_amount refund_amount source source_company over_2000 over_4000 ringcentral";
  const [forms, calls, bookings, cancellations] = await Promise.all([
    getFormLeadModel().find({ source_company: "best_relocation_leads" }).select(projection).sort({_id:1}).limit(10001).lean(),
    getCallLeadModel().find({ source_company: "best_relocation_leads" }).select(projection).sort({_id:1}).limit(10001).lean(),
    BookedLead.find({}).select(projection).sort({_id:1}).limit(10001).lean(),
    CancelledLead.find({}).select(projection).sort({_id:1}).limit(10001).lean(),
  ]);
  if ([forms,calls,bookings,cancellations].some(rows => rows.length > 10000)) throw new Error("source_evidence_bound_exceeded");
  const result = { run_id: runId, plan_checksum: plan.checksum, captured_at: new Date(), database: mongoose.connection.name,
    deployment: await mongoose.connection.db!.collection("sales_intelligence_sync_state").findOne({scope:"deployment"}),
    company, sources, connection, entities: { forms, calls, bookings, cancellations },
    command_count: await DomainCommandExecution.countDocuments({ "provenance.run_id": runId }),
    receipt_count: await SourceRowReceipt.countDocuments({ ingestion_run_id: runId }),
    memberships: serializedMemberships(await readMemberships()) };
  await save(`${runId}-source-evidence.json`, result);
  return { run_id: runId, entity_hash: hash(result.entities), membership_hash: hash({leads:result.memberships.leads,booked:result.memberships.booked}),
    counts: { forms:forms.length,calls:calls.length,bookings:bookings.length,cancellations:cancellations.length,commands:result.command_count,receipts:result.receipt_count },
    source_company_active: company?.active, scheduling_disabled: connection?.application_enabled === false && connection?.next_due_at == null,
    deployment: result.deployment && {commit:result.deployment.deployment_commit,recorded_at:result.deployment.recorded_at,deployment_id:result.deployment.vercel_deployment_id},
    policies_link_only: sources.every(row => row.lead_created_policy === "link_only") };
}

async function verifySource(plan: RetirementSourcePlan, runId: string) {
  await database();
  const memberships = await readMemberships();
  const connection = await ExternalDataConnection.findOne({ key: "best_relocation" }).lean();
  if (!connection) throw new Error("missing_final_connection");
  const discrepancies: unknown[] = [];
  for (const action of await resolvedReviews(plan, String(connection._id))) {
    if (action.conflict || !action.lead_id) { discrepancies.push({ stable_id:action.stable_source_row_id, reason:action.conflict ?? "unresolved_dependency" }); continue; }
    const Model = (action.lead_model === "FormLead" ? getFormLeadModel() : getCallLeadModel()) as mongoose.Model<any>;
    const row = await Model.findById(action.lead_id).lean();
    if (!row) { discrepancies.push({id:action.lead_id,reason:"canonical_missing"}); continue; }
    const expected = planExpectedSheetTabs(action.lead_model,row).expected.map(tab=>tab.tabName);
    const tabs = action.lead_model === "FormLead" ? ["Forms","Duplicate Forms","Bad Form Leads"] : ["Calls","Duplicate Calls","Bad Call Leads"];
    for (const tab of tabs) {
      const count=memberships.leads.get(tab)?.get(action.lead_id.toLowerCase())??0;
      if (count!==Number(expected.includes(tab))) discrepancies.push({id:action.lead_id,tab,count,reason:"physical_membership"});
    }
    if (action.classification!=="unchanged" && row.external_sheet_review?.source_content_hash!==action.cell.source_content_hash)
      discrepancies.push({id:action.lead_id,reason:"review_fact_missing_or_different"});
  }
  const financial = await verifyCanonicalFinancials(plan,runId,String(connection._id),memberships.booked);
  const sourceConflicts=plan.canonical_plan.actions.filter(action=>["conflict","invalid"].includes(action.classification));
  const result = { run_id:runId,complete:financial.complete && !discrepancies.length && !sourceConflicts.length,
    financial,source_discrepancies:discrepancies,source_conflicts:sourceConflicts.map(action=>({action_key:action.action_key,type:action.conflict?.type})),
    skipped_source_rows:plan.skipped_source_rows?.length,booking_accounting:plan.booking_graph?.accounting,topology:memberships.tabs };
  await save(`${runId}-source-verification.json`,result); return result;
}

async function verify(plan: RetirementSourcePlan, calls: CallBackfillPlan, runId: string) {
  await database();
  await assertAppliedCallPlan(plan, calls, runId);
  const memberships = await readMemberships();
  const count = (tab: string, id: string) => memberships.leads.get(tab)?.get(id.toLowerCase()) ?? 0;
  const general = await verifyCallBackfill(calls, { readMembership: async id => ({ calls: count("Calls", id), duplicate_calls: count("Duplicate Calls", id), bad_call_leads: count("Bad Call Leads", id) }) });
  const connection = await ExternalDataConnection.findOne({ key: "best_relocation" }).lean();
  if (!connection) throw new Error("missing_final_connection");
  const reviews = await resolvedReviews(plan, String(connection._id)), discrepancies: unknown[] = [];
  for (const action of reviews) {
    if (action.conflict || !action.lead_id) { discrepancies.push({ stable_id: action.stable_source_row_id, reason: action.conflict ?? "unresolved_dependency" }); continue; }
    const Model = (action.lead_model === "FormLead" ? getFormLeadModel() : getCallLeadModel()) as mongoose.Model<any>;
    const row = await Model.findById(action.lead_id).lean();
    if (!row) { discrepancies.push({ id: action.lead_id, reason: "canonical_missing" }); continue; }
    const expected = planExpectedSheetTabs(action.lead_model, row).expected.map(tab => tab.tabName);
    const candidateTabs = action.lead_model === "CallLead" ? ["Calls", "Duplicate Calls", "Bad Call Leads"] : ["Forms", "Duplicate Forms", "Bad Form Leads"];
    for (const tab of candidateTabs) if (count(tab, action.lead_id) !== Number(expected.includes(tab))) discrepancies.push({ id: action.lead_id, tab, reason: "physical_membership" });
    if (action.classification !== "unchanged" && row.external_sheet_review?.source_content_hash !== action.cell.source_content_hash) discrepancies.push({ id: action.lead_id, reason: "review_fact_missing_or_different" });
  }
  const financial = await verifyCanonicalFinancials(plan, runId, String(connection._id), memberships.booked);
  const invalidTimes = Object.values(plan.inventory).reduce((n, tab) => n + tab.invalid_time, 0);
  const result = { run_id: runId, complete: general.complete && financial.complete && !discrepancies.length && !invalidTimes && !plan.canonical_plan.actions.some(a=>a.classification === "conflict" || a.classification === "invalid"),
    general, financial, source_discrepancies: discrepancies, invalid_source_times: invalidTimes, source_counters: plan.counters, canonical_counters: plan.canonical_plan.counters, topology: memberships.tabs };
  await save(`${runId}-membership-after.json`, serializedMemberships(memberships)); await save(`${runId}-verification.json`, result); return result;
}

async function main() {
  if (mode === "shutdown-ingestion") {
    await assertDeployment(required("deployment"));
    const plan=await load<RetirementSourcePlan>(required("plan"));
    if (retirementPlanChecksum(plan)!==plan.checksum) throw new Error("plan_checksum_mismatch");
    const result=await shutdownBestRelocationWithoutIngestion({company_id:plan.registry.company_id,
      source_ids:plan.registry.sources.map(source=>String((source as {_id:unknown})._id)),shutdown_id:required("shutdown-id"),actor:owner});
    await save("shutdown-with-ingestion-deferred.json",result); summary({mode,...result}); return;
  }
  if (mode === "general-plan") {
    const calls=await planCallBackfill({through:option("through")??new Date().toISOString(),deploymentId:required("deployment")});
    await save("call-plan.json",calls); summary({mode,checksum:calls.checksum,from:calls.from,through:calls.through,totals:calls.totals,
      held_best_relocation_candidates:calls.items.filter(item=>item.source_granularity_id===BEST_RELOCATION_ADMISSION_CALL_FEED_ID).length}); return;
  }
  if (["general-apply","general-verify","general-evidence"].includes(mode)) {
    const calls=await load<CallBackfillPlan>(required("call-plan")),runId=required("run-id");
    if (callBackfillPlanChecksum(calls)!==calls.checksum) throw new Error("call_plan_checksum_mismatch");
    await assertDeployment(required("deployment"));
    if (calls.items.some(item=>item.source_granularity_id===BEST_RELOCATION_ADMISSION_CALL_FEED_ID) ||
      await getCallLeadModel().exists({_id:{$in:calls.items.map(item=>item.lead_id)},$or:[{source_company:"best_relocation_leads"},{lead_source_company:BEST_RELOCATION_ADMISSION_COMPANY_ID}]})) throw new Error("general_backfill_contains_held_best_relocation_candidates");
    if (mode==="general-evidence") {
      const rows=await getCallLeadModel().find({_id:{$in:calls.items.map(item=>item.lead_id)}}).select("_id domain_revision ringcentral form_fill duplicate external_call_admission external_sheet_review").lean();
      const memberships=serializedMemberships(await readMemberships());
      const evidence={run_id:runId,plan_checksum:calls.checksum,captured_at:new Date(),entities:rows,memberships};
      await save(`${runId}-general-evidence.json`,evidence);summary({mode,run_id:runId,entities:rows.length});return;
    }
    if (required("expected-database")!=="vantagemovers") throw new Error("explicit_database_mismatch");
    const result=await withLease("lead-reporting:general-call-backfill",runId,async(_lease,assertLease)=>{
      const input={plan:calls,checksum:required("checksum"),expectedDatabase:"vantagemovers",deploymentId:required("deployment"),runId,owner,assertLease};
      if (mode==="general-apply") return applyGeneralCallRun(input);
      const membership=await readMemberships();
      return verifyGeneralCallRun({...input,readMembership:async id=>({calls:membership.leads.get("Calls")?.get(id)??0,
        duplicate_calls:membership.leads.get("Duplicate Calls")?.get(id)??0,bad_call_leads:membership.leads.get("Bad Call Leads")?.get(id)??0})});
    });
    await save(`${runId}-${mode}.json`,result);
    summary(mode==="general-apply"?{mode,run_id:runId,completed:(result as Awaited<ReturnType<typeof applyGeneralCallRun>>).completed.length,
      conflicts:(result as Awaited<ReturnType<typeof applyGeneralCallRun>>).conflicts,unresolved:result.unresolved}:result); return;
  }
  if (mode === "inspect-formulas") {
    const plan = await inspectDerivativeFormulas(getSheetsClient()); await save("derivative-plan.json", plan);
    summary({mode,checksum:plan.checksum,workbooks:plan.workbooks.map(book=>({id:book.spreadsheetId,renames:book.renames,formulas:book.formulas.length,conflicts:book.conflicts})),conflicts:plan.conflicts}); return;
  }
  if (mode === "inspect") {
    if (has("final-capture")) { await assertDeployment(required("deployment")); }
    const snapshot = has("final-capture") ? await withLease("ingestion:best_relocation:apply", `capture:${randomUUID()}`, async (_lease, assertLease) => {
      if (await IngestionRun.exists({ adapter_key: "best_relocation", status: { $in: ["inspecting", "planning", "applying"] }, leased_until: { $gt: new Date() } })) throw new Error("old_ingestion_run_still_active");
      const beforeConnection = await ExternalDataConnection.findOne({ key: "best_relocation" }).lean();
      await save("connection-before-quiesce.json", beforeConnection);
      await ExternalDataConnection.updateOne({ key: "best_relocation", retired_at: null }, { $set: { application_enabled: false, next_due_at: null } });
      await assertLease(); return captureSourceSnapshot(true);
    }) : await captureSourceSnapshot(false); await save("source-snapshot.json", snapshot);
    summary({ mode, snapshot_hash: hash(snapshot), through: snapshot.through, final_capture: snapshot.final_capture, output }); return;
  }
  if (mode === "plan") {
    const snapshot = await load<FrozenSourceSnapshot>(required("source-snapshot"));
    if (option("through") && option("through") !== snapshot.through) throw new Error("snapshot_through_is_immutable");
    const plan = await planSourceReconciliation(snapshot); await save("source-plan.json", plan);
    if (has("source-only")) { summary({mode,source_only:true,checksum:plan.checksum,through:plan.through,counters:plan.counters,
      canonical_counters:plan.canonical_plan.counters,held_new_normal_calls:plan.new_normal_call_flags?.length}); return; }
    const calls = await planCallBackfill({ through: snapshot.through, deploymentId: required("deployment") }); await save("call-plan.json", calls);
    const topology = await inspectLeadTabMigration(getSheetsClient(), getMasterLeadsSheetContainerId()); await save("tab-plan.json", topology);
    await save("derivative-plan.json", await inspectDerivativeFormulas(getSheetsClient()));
    await save("membership-before-plan.json", serializedMemberships(await readMemberships()));
    summary({ mode, checksum: plan.checksum, call_checksum: calls.checksum, counters: plan.counters, inventory: plan.inventory, call_totals: calls.totals, topology }); return;
  }
  if (mode === "drain") { await assertDeployment(required("deployment")); summary(await runSheetSyncDrain("script")); return; }
  if (mode === "plan-calls") {
    const sourcePlan = await load<RetirementSourcePlan>(required("plan"));
    const calls = await planCallBackfill({ through: sourcePlan.through, deploymentId: required("deployment") });
    await save("call-plan.json", calls); summary({mode, checksum: calls.checksum, totals: calls.totals}); return;
  }
  if (mode === "migrate-tabs") {
    await assertDeployment(required("deployment"));
    const sheets = getSheetsClient(), plan = await load<Awaited<ReturnType<typeof inspectLeadTabMigration>>>(required("tab-plan"));
    const derivatives = await load<DerivativeFormulaPlan>(required("derivative-plan"));
    const result = await withLease("lead-reporting:tab-migration", `migration:${randomUUID()}`, async (_lease, assertLease) =>
      withLease("sheet-sync:drain", `migration:${randomUUID()}`, async (_drainLease, assertDrainLease) => {
        // api/index.ts permits 800 seconds. Let any older legacy invocation
        // which passed its write check finish before changing physical titles.
        const readyAt = Date.now() + 805000;
        while (Date.now() < readyAt) {
          await assertLease(); await assertDrainLease();
          summary({ mode, state: "writers_fenced_quiescing", seconds_remaining: Math.ceil((readyAt-Date.now())/1000) });
          await new Promise(resolve => setTimeout(resolve, Math.min(30000, readyAt-Date.now())));
        }
        await assertLease(); await assertDrainLease();
        const assert = async () => { await assertLease(); await assertDrainLease(); };
        const topology = await applyLeadTabMigration(sheets, plan, { writersFenced: true, assertLease: assert });
        const formulas = await applyDerivativeFormulas(sheets, derivatives, { writersFenced: true, assertLease: assert });
        await save("derivative-migration-result.json", formulas);
        if (!formulas.complete) throw new Error("derivative_formula_verification_incomplete");
        return { topology, formulas };
      }));
    await save("tab-migration-result.json", result); summary({ mode, result }); return;
  }
  const plan = await load<RetirementSourcePlan>(required("plan"));
  if (retirementPlanChecksum(plan) !== plan.checksum) throw new Error("plan_checksum_mismatch");
  const runId = option("run-id") ?? new mongoose.Types.ObjectId().toHexString();
  if (mode === "source-evidence") { summary(await sourceEvidence(plan,required("run-id")));return; }
  if (mode === "verify-source") { summary(await verifySource(plan,required("run-id")));return; }
  if (mode === "finalize-source") {
    await assertDeployment(required("deployment"));
    const first=await load<any>(required("replay-before")),second=await load<any>(required("replay-after"));
    if ([first,second].some(value=>value.run_id!==required("run-id") || value.plan_checksum!==plan.checksum) ||
      hash(first.entities)!==hash(second.entities) || first.command_count!==second.command_count || first.receipt_count!==second.receipt_count ||
      hash({leads:first.memberships.leads,booked:first.memberships.booked})!==hash({leads:second.memberships.leads,booked:second.memberships.booked})) throw new Error("same_plan_replay_proof_missing_or_changed");
    const verification=await verifySource(plan,required("run-id"));
    if (!verification.complete) throw new Error("final_source_verification_incomplete");
    const result=await retireBestRelocationConnectionAndSources({company_id:plan.registry.company_id,
      source_ids:plan.registry.sources.map(source=>String((source as {_id:unknown})._id)),final_run_id:required("run-id"),actor:owner,reconciliation_status:"complete"});
    await save(`${runId}-final-source-complete.json`,{...result,plan_checksum:plan.checksum,source_company_deactivated:false,
      replay_entity_hash:hash(first.entities),replay_membership_hash:hash({leads:first.memberships.leads,booked:first.memberships.booked}),verification});
    summary({mode,run_id:runId,final_source_reconciliation_complete:true,source_company_deactivated:false,...result});return;
  }
  if (["apply-source","apply","resume"].includes(mode)) { const result = await apply(plan, runId); summary({ mode, run_id: runId, canonical: result.canonical, review_conflicts: result.reviews.filter(o=>o.outcome === "conflict").length }); return; }
  const calls = await load<CallBackfillPlan>(required("call-plan"));
  if (mode === "apply-calls") {
    if (required("expected-database") !== "vantagemovers") throw new Error("explicit_database_mismatch");
    await assertDeployment(required("deployment"));
    assertCallPlanWatermark(plan, calls);
    if (calls.deployment_id !== required("deployment")) throw new Error("call_plan_deployment_mismatch");
    const result = await withLease("ingestion:best_relocation:apply", required("run-id"), async (lease, assertLease) => {
      const run = await IngestionRun.findById(runId).select("status plan_checksum approval").lean();
      if (!run || !["completed","completed_with_errors"].includes(run.status) || run.plan_checksum !== plan.checksum || !(run.approval as {apply_result?:unknown})?.apply_result) throw new Error("source_phase_not_completed");
      const existing = (run.approval as {call_plan?:{checksum:string}})?.call_plan;
      if (existing && existing.checksum !== calls.checksum) throw new Error("call_plan_already_bound_requires_separate_tail_run");
      const binding = {checksum:calls.checksum, source_checksum:plan.checksum, snapshot_hash:plan.snapshot_hash,
        through:calls.through, deployment_id:calls.deployment_id, applied:false};
      await IngestionRun.updateOne({_id:runId,plan_checksum:plan.checksum},{$set:{"approval.call_plan":binding}});
      const applied = await applyCallBackfill(calls, {checksum: required("checksum"), expectedDatabase: "vantagemovers", owner, assertLease,
        checkpoint: async (purpose,id) => save(`${runId}-call-checkpoint.json`,{purpose,id}) });
      await assertLease();
      await IngestionRun.updateOne({_id:runId,plan_checksum:plan.checksum,"approval.call_plan.checksum":calls.checksum},{$set:{"approval.call_plan.applied":true,"approval.call_apply_result":{completed:applied.completed.length,conflicts:applied.conflicts.length,unresolved:applied.unresolved.length}, lease_owner:lease().owner,lease_epoch:lease().epoch}});
      return applied;
    });
    await save(`${runId}-call-apply-result.json`,result); summary({mode,completed:result.completed.length,conflicts:result.conflicts,unresolved:result.unresolved}); return;
  }
  if (mode === "verify") { summary(await verify(plan, calls, required("run-id"))); return; }
  if (mode === "retire") {
    await assertDeployment(required("deployment"));
    const evidence = await verify(plan, calls, required("run-id"));
    if (!evidence.complete && !has("retire-with-incomplete-evidence")) throw new Error("final_reconciliation_incomplete_use_explicit_incomplete_retirement_mode");
    const result = await retireBestRelocationConnectionAndSources({ company_id: plan.registry.company_id,
      source_ids: plan.registry.sources.map(source => String((source as { _id: unknown })._id)), final_run_id: required("run-id"), actor: owner, reconciliation_status: evidence.complete ? "complete" : "incomplete" });
    await save(`${runId}-retirement.json`, { ...result, final_reconciliation_complete: evidence.complete }); summary({ mode, ...result, final_reconciliation_complete: evidence.complete }); return;
  }
  throw new Error("unsupported_operator_mode");
}
withRuntimeDomainOverrides({ sheetSyncMode: "queued" }, main).catch(error => { console.error(JSON.stringify({ ok: false, error_code: error instanceof Error ? error.message.slice(0,200) : "operator_failed" })); process.exitCode = 1; }).finally(async () => { await mongoose.disconnect(); });
