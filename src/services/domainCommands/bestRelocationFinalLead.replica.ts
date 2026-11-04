import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mock } from "node:test";
import mongoose from "mongoose";

async function main() {
  // This proof owns only a disposable loopback database and loads no .env.
  const database = `testvantagemovers_finalimport${process.pid}`;
  process.env.TEST_MODE = "true";
  process.env.TEST_MONGO_DATABASE_NAME = database;
  process.env.MONGO_URI = "mongodb://127.0.0.1:27119/?replicaSet=callReportingProof";
  process.env.SHEET_SYNC_MODE = "queued";
  await import("../../../ops/test-setup.js");
  const { logger } = await import("../../logger.js");
  for (const level of ["info", "warn", "error"] as const) mock.method(logger, level, () => {});
  mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    assert.match(url, /^https:\/\/api\.zippopotam\.us\/us\/(10001|94105)$/);
    return new Response(JSON.stringify({ places: [{ "state abbreviation": url.endsWith("10001") ? "NY" : "CA" }] }), { status: 200 });
  });
  const { connectMongo } = await import("../../db.js");
  const { getLeadSourceCompanyModel } = await import("../../models/LeadSourceCompany.js");
  const { getLeadSourceGranularityModel } = await import("../../models/LeadSourceGranularity.js");
  const { getFormLeadModel } = await import("../../models/FormLead.js");
  const { getCallLeadModel } = await import("../../models/CallLead.js");
  const { BookedLead } = await import("../../models/BookedLead.js");
  const { ExternalDataConnection } = await import("../../models/ExternalDataConnection.js");
  const { IngestionRun } = await import("../../models/IngestionRun.js");
  const { SheetSyncLease } = await import("../../models/SheetSyncLease.js");
  const { SheetSyncJob } = await import("../../models/SheetSyncJob.js");
  const { DomainCommandExecution } = await import("../../models/DomainCommandExecution.js");
  const { EntityChange } = await import("../../models/EntityChange.js");
  const { SourceRowReceipt } = await import("../../models/SourceRowReceipt.js");
  const { SourceRowState } = await import("../../models/SourceRowState.js");
  const { appendSourceReceipt } = await import("../ingestion/repository.js");
  const { reconcileExternalSheetReview, reviewPayloadChecksum } = await import("./externalSheetReview.js");
  const { findEquivalentFrozenReview, assertEquivalentReviewRevision } = await import("../../../ops/best-relocation-retirement/reviewAliases.js");
  const { enqueueSheetSyncJob } = await import("../sheetSync/sheetSyncOutbox.service.js");
  const { createBestRelocationIngestionActor, MongoLeaseStore, computeChecksum } = await import("../durableWork/index.js");
  const { createFormLead } = await import("./leads.js");
  const { admitBestRelocationFinalCall, bestRelocationFinalCallPayloadChecksum } = await import("./bestRelocationFinalCall.js");
  const { BEST_RELOCATION_ADMISSION_COMPANY_ID: companyId, BEST_RELOCATION_ADMISSION_CALL_FEED_ID: callFeedId } = await import("../leads/callLeadAdmission.js");
  const { BEST_RELOCATION_TRACKER_ID } = await import("../leads/externalSheetReview.js");
  const { planExpectedSheetTabs } = await import("../googleSheets/expectedSheetTabs.js");
  type Action = import("../bestRelocationSheetIngest/applicationPlan.js").BestRelocationPlanAction;
  type Context = import("./types.js").CanonicalCommandContext;
  type ReviewAction = import("../../../ops/best-relocation-retirement/sourcePlan.js").ReviewAction;
  type RetirementSourcePlan = import("../../../ops/best-relocation-retirement/sourcePlan.js").RetirementSourcePlan;
  const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  await connectMongo();
  assert.equal(mongoose.connection.host, "127.0.0.1");
  assert.equal(mongoose.connection.name, database);
  assert.equal((await mongoose.connection.db!.admin().command({ hello: 1 })).setName, "callReportingProof");
  try {
    await Promise.all([getFormLeadModel(), getCallLeadModel(), BookedLead, ExternalDataConnection, IngestionRun,
      SheetSyncLease, SheetSyncJob, DomainCommandExecution, EntityChange, SourceRowReceipt, SourceRowState].map(async Model => {
      try { await Model.createCollection(); } catch (error: any) { if (error.code !== 48) throw error; }
    }));
    await Promise.all([SheetSyncLease, SheetSyncJob, DomainCommandExecution, EntityChange, getCallLeadModel(), SourceRowReceipt, SourceRowState].map(Model => Model.createIndexes()));
    const formFeed = await getLeadSourceGranularityModel().create({ source_company: companyId, granularity_key: "proof_form", channel: "form",
      owner_label: "Proof Form", crm_label: "Proof Form", active: true });
    await getLeadSourceGranularityModel().create({ _id: callFeedId, source_company: companyId, granularity_key: "proof_call", channel: "call",
      owner_label: "Proof Call", crm_label: "Proof Call", active: true });
    await getLeadSourceCompanyModel().create({ _id: companyId, company_slug: "best_relocation_leads", name: "Proof Best", owner_label: "Proof Best", active: true,
      default_form_granularity: formFeed._id, default_form_granularity_key: "proof_form", default_call_granularity: callFeedId, default_call_granularity_key: "proof_call" });
    const owner = { actor_type: "owner", actor_id: "synthetic-owner", actor_label: "Synthetic Owner", actor_role: "owner", request_id: "final-import-proof", origin: "vantage_admin" } as const;
    const actor = createBestRelocationIngestionActor("final-import-proof");
    const connection = await ExternalDataConnection.create({ key: "best_relocation", provider: "google_sheets", application_enabled: false,
      retirement_ingestion_deferred: true, workbook_env_keys: { leads: "archived", booked: "archived" }, created_actor: owner, updated_actor: owner });
    const lease = await new MongoLeaseStore(SheetSyncLease).acquire({ scope: "ingestion:best_relocation:apply", owner: "final-import-proof", ttl_ms: 600_000, now: new Date() });
    assert.ok(lease);
    const form = (key: string, phone: string, note = "", timestamp = "2026-05-01T12:00:00Z"): Action => ({
      action_key: `proof:${key}`, command: "create_form_lead", classification: "create", dataset_key: "forms", stable_source_row_id: `lead:${key}`,
      content_hash: sha(key), schema_profile: "forms:v2", schema_version: 2, depends_on: [],
      command_payload: { source_company: "best_relocation_leads", source_granularity_key: "proof_form", name: "Synthetic Proof", phone_number: phone,
        timestamp, pickup_zip: "10001", destination_zip: "94105", move_size: "Studio", lid: `LID${sha(key).slice(0, 13)}`, ref_no: key, post_to_granot: false, sms_consent: false },
      provenance: { workbook_id: BEST_RELOCATION_TRACKER_ID, workbook_title: "Synthetic", tab: "Forms", sheet_row: 2,
        source_row_key: key, raw: { "Bad Lead Checker": note } } });
    const bad = form("bad", "5550100101", "Duplicate Form"), forbidden = form("forbidden", "5550100102"),
      allowed = form("allowed", "5550100103"), duplicate = form("duplicate", "5550100101", "", "2026-05-02T12:00:00Z"), interrupted = form("interrupted", "5550100104", "invalid contact");
    const normalCall: Action = { ...allowed, action_key: "proof:call-allowed", command: "admit_final_best_relocation_call", dataset_key: "calls", stable_source_row_id: "proof:call-allowed",
      command_payload: { source_company: "best_relocation_leads", lead_source_company: companyId, source_granularity_id: callFeedId,
        phone_number: "5550100201", timestamp: "2026-05-03T12:00:00Z", duplicate: false, reviewed_for_insert: true, expected_disposition: "calls" },
      provenance: { workbook_id: BEST_RELOCATION_TRACKER_ID, workbook_title: "Synthetic", tab: "Calls", sheet_row: 3,
        source_row_key: "proof:call-allowed", raw: { "Form Fill Checker": "" } } };
    const forbiddenCall: Action = { ...normalCall, action_key: "proof:call-forbidden", stable_source_row_id: "proof:call-forbidden",
      command_payload: { ...normalCall.command_payload, phone_number: "5550100202" } };
    const booking: Action = { ...allowed, action_key: "proof:booking", dataset_key: "booked_deals", command: "adopt_existing", classification: "adoption", stable_source_row_id: "booking:proof",
      adopted_entity_refs: [{ model: "BookedLead", id: new mongoose.Types.ObjectId().toHexString() }], command_payload: { job_no: "PROOF", source: "best_relocation_leads" } };
    await BookedLead.collection.insertOne({ _id: new mongoose.Types.ObjectId(booking.adopted_entity_refs![0]!.id), source: "best_relocation_leads", job_no: "PROOF", total_binder_amount: 100, deposit_amount: 0 });
    for (const action of [allowed, normalCall]) action.matching = { method: "definite_booking", calibration_version: "proof-v1", evidence: [`booking_action:${booking.action_key}`] };
    const signed = { canonical_plan: { actions: [bad, forbidden, allowed, duplicate, interrupted, normalCall, forbiddenCall, booking] },
      booking_matches: [allowed, normalCall].map(action => ({ lead_action_key: action.action_key, booking_action_key: booking.action_key,
        booking_identity: booking.stable_source_row_id, evidence: ["synthetic exact durable source identity"] })) };
    const checksum = sha(signed), run = await IngestionRun.create({ adapter_key: "best_relocation", schema_version: 3, trigger: "manual", status: "applying",
      connection_id: connection._id, cutoff: new Date("2026-04-30T04:00:00Z"), timezone: "America/New_York", source_read_through: new Date("2026-11-03T12:00:00Z"),
      actor, initiator: owner, plan_snapshot: { ...signed, checksum }, plan_checksum: checksum,
      approval: { final_reconciliation: true, owner_released_deferred_ingestion_checksum: checksum, normal_call_insert_approval: checksum },
      lease_owner: lease.owner, lease_epoch: lease.epoch, leased_until: lease.leased_until });
    const context = (action: Action): Context => ({ command_id: new mongoose.Types.ObjectId().toHexString(), idempotency_key: action.action_key,
      payload_checksum: action.command === "admit_final_best_relocation_call" ? bestRelocationFinalCallPayloadChecksum(action) : computeChecksum({
        checksum_version: 1, artifact_kind: "ingestion_plan", schema_version: action.schema_version, payload: action.command_payload }),
      actor, initiator: owner, provenance: { origin: "external_sheet_ingestion", source_connection_key: "best_relocation", run_id: String(run._id), source_receipt_id: new mongoose.Types.ObjectId().toHexString() } });
    const create = (action: Action, commandContext = context(action)) => createFormLead({ data: action.command_payload, context: commandContext });
    let beforeCommitSeen = false;
    const original = SheetSyncJob.findOneAndUpdate;
    const watcher = mock.method(SheetSyncJob, "findOneAndUpdate", async function (...args: any[]) {
      const update = args[1]?.$set;
      if (update?.entity_model === "FormLead" && args[2]?.session) {
        const inTransaction = await getFormLeadModel().findById(update.entity_id).session(args[2].session).lean();
        if (inTransaction?.ref_no === "bad") {
          assert.equal(inTransaction.external_sheet_review?.kind, "bad_form");
          assert.deepEqual(planExpectedSheetTabs("FormLead", inTransaction).expected.map(tab => tab.tabName), ["Bad Form Leads"]);
          assert.equal(await getFormLeadModel().countDocuments({ _id: update.entity_id }), 0);
          assert.equal(await SheetSyncJob.countDocuments({ entity_id: update.entity_id }), 0);
          beforeCommitSeen = true;
        }
      }
      return original.apply(SheetSyncJob, args as Parameters<typeof original>);
    });
    const badContext = context(bad), badResult = await create(bad, badContext);
    watcher.mock.restore();
    assert.equal(beforeCommitSeen, true);
    const badId = badResult.entity_refs[0]!.id, badSaved = await getFormLeadModel().findById(badId).lean();
    assert.equal(badSaved?.external_sheet_review?.kind, "bad_form");
    assert.equal(badSaved?.outreach_automation_suppressed, true);
    const counts = async () => ({ forms: await getFormLeadModel().countDocuments(), calls: await getCallLeadModel().countDocuments(),
      commands: await DomainCommandExecution.countDocuments(), changes: await EntityChange.countDocuments(), outbox: await SheetSyncJob.countDocuments() });
    const afterBad = await counts();
    await assert.rejects(create(forbidden), /persisted definite Booking/);
    await assert.rejects(admitBestRelocationFinalCall({ action: forbiddenCall, context: context(forbiddenCall) }), /persisted definite Booking/);
    assert.deepEqual(await counts(), afterBad);
    await create(allowed);
    const duplicateResult = await create(duplicate);
    assert.equal((await getFormLeadModel().findById(duplicateResult.entity_refs[0]!.id).lean())?.duplicate, true);
    await admitBestRelocationFinalCall({ action: normalCall, context: context(normalCall) });
    const interruptedContext = context(interrupted), beforeFailure = await counts();
    await IngestionRun.updateOne({ _id: run._id }, { $set: { lease_epoch: lease.epoch + 1 } });
    await assert.rejects(create(interrupted, interruptedContext), /lease_lost/);
    assert.deepEqual(await counts(), beforeFailure);
    await IngestionRun.updateOne({ _id: run._id }, { $set: { lease_epoch: lease.epoch } });
    await create(interrupted, interruptedContext);
    const beforeReplay = await counts();
    const protectedBefore = await getFormLeadModel().findById(badId).select("domain_revision external_sheet_review outreach_automation_suppressed duplicate").lean();
    assert.equal((await create(bad, badContext)).status, "already_applied");
    assert.equal((await create(interrupted, interruptedContext)).status, "already_applied");
    assert.deepEqual(await counts(), beforeReplay);
    assert.deepEqual(await getFormLeadModel().findById(badId).select("domain_revision external_sheet_review outreach_automation_suppressed duplicate").lean(), protectedBefore);

    // Two independently frozen source rows can adopt one existing canonical
    // Form. The first review owns its immutable namespace; the second must
    // preserve that stamp rather than adjust its failed canonical envelope.
    const aliasTargetId = new mongoose.Types.ObjectId();
    const protectedAliasFields = { source_company: "best_relocation_leads", lead_source_company: new mongoose.Types.ObjectId(companyId),
      source_granularity_id: formFeed._id, duplicate: true, over_2000: true, over_4000: false, no_sync: false,
      job_no: "PROOF-PRESERVED", booked: new mongoose.Types.ObjectId(booking.adopted_entity_refs![0]!.id), outreach_automation_suppressed: true };
    await getFormLeadModel().collection.insertOne({ _id: aliasTargetId, ...protectedAliasFields, name: "Synthetic Alias Proof", phone_number: "5550100301",
      domain_revision: 3, timestamp: new Date("2026-05-01T08:00:00Z"), createdAt: new Date("2026-05-01T12:00:00Z") });
    const primaryReview: ReviewAction = { dataset_key: "local_forms", stable_source_row_id: "lead:primary-review", lead_model: "FormLead",
      lead_id: String(aliasTargetId), expected_revision: 3, classification: "bad_form", row: 984,
      cell: { source_workbook_id: BEST_RELOCATION_TRACKER_ID, source_sheet_id: 584355266, source_tab: "Local Forms",
        stable_source_row_id: "lead:primary-review", source_content_hash: sha("primary-source"), raw_value: "Duplicate Form" } };
    const aliasReview: ReviewAction = { ...primaryReview, stable_source_row_id: "lead:secondary-review", row: 985,
      cell: { ...primaryReview.cell, stable_source_row_id: "lead:secondary-review", source_content_hash: sha("secondary-source") } };
    const reviewSigned = { review_actions: [primaryReview, aliasReview], through: "2026-11-03T12:00:00Z" };
    const reviewPlan = { ...reviewSigned, checksum: sha(reviewSigned) } as RetirementSourcePlan;
    const frozenReviewPlanBefore = structuredClone(reviewPlan);
    const reviewRun = await IngestionRun.create({ adapter_key: "best_relocation", schema_version: 3, trigger: "manual", status: "applying",
      connection_id: connection._id, cutoff: new Date("2026-04-30T04:00:00Z"), timezone: "America/New_York", source_read_through: new Date(reviewPlan.through),
      actor, initiator: owner, plan_snapshot: reviewPlan, plan_checksum: reviewPlan.checksum,
      approval: { final_reconciliation: true, owner_released_deferred_ingestion_checksum: reviewPlan.checksum },
      lease_owner: lease.owner, lease_epoch: lease.epoch, leased_until: lease.leased_until });
    const reviewRunId = String(reviewRun._id);
    const receiptId = (action: ReviewAction) => sha([reviewRunId, action.dataset_key, action.stable_source_row_id, action.cell.source_content_hash]).slice(0, 24);
    const reviewCommand = (action: ReviewAction) => {
      const payload = { lead_model: action.lead_model, lead_id: action.lead_id!, expected_revision: action.expected_revision!, cell: action.cell };
      const payloadChecksum = reviewPayloadChecksum(payload);
      const commandContext: Context = { command_id: receiptId(action), idempotency_key: `retirement-review:${payloadChecksum}`, payload_checksum: payloadChecksum,
        actor, initiator: owner, provenance: { origin: "external_sheet_ingestion", source_connection_key: "best_relocation", run_id: reviewRunId, source_receipt_id: receiptId(action) } };
      return { ...payload, execution: { lease }, context: commandContext };
    };
    const sourceReceipt = (action: ReviewAction, outcome: string, matching?: Record<string, unknown>) => ({ _id: receiptId(action),
      connection_id: String(connection._id), dataset_key: action.dataset_key, stable_source_row_id: action.stable_source_row_id,
      content_hash: action.cell.source_content_hash, schema_profile: "best-relocation-retirement-v1", schema_version: 3,
      workbook_id: action.cell.source_workbook_id, workbook_title: "Synthetic", tab_id: action.cell.source_sheet_id, tab_name: action.cell.source_tab,
      last_observed_row_number: action.row, range: `${action.cell.source_tab}:frozen`, observed_at: new Date(reviewPlan.through), ingestion_run_id: reviewRunId,
      observation_type: "final_review", classification: action.classification, outcome, resulting_canonical_model: action.lead_model,
      resulting_canonical_ids: [action.lead_id!], source_state: "present" as const, ...(matching ? { matching } : {}) });
    const aliasCounts = async () => ({ commands: await DomainCommandExecution.countDocuments({ "provenance.run_id": reviewRunId }),
      changes: await EntityChange.countDocuments({ "entity.id": String(aliasTargetId), "provenance.run_id": reviewRunId }),
      receipts: await SourceRowReceipt.countDocuments({ ingestion_run_id: reviewRunId }),
      states: await SourceRowState.countDocuments({ last_ingestion_run_id: reviewRunId }),
      outbox: await SheetSyncJob.countDocuments({ entity_id: String(aliasTargetId) }) });
    assert.equal((await reconcileExternalSheetReview(reviewCommand(primaryReview))).status, "applied");
    assert.equal((await appendSourceReceipt(sourceReceipt(primaryReview, "applied"))).inserted, true);
    const afterPrimary = await getFormLeadModel().findById(aliasTargetId).lean();
    assert.ok(afterPrimary);
    assert.equal(afterPrimary.domain_revision, 4);
    assert.equal(afterPrimary.external_sheet_review?.stable_source_row_id, primaryReview.stable_source_row_id);
    assert.equal(afterPrimary.external_sheet_review?.source_row_receipt_id, receiptId(primaryReview));
    assert.deepEqual(await aliasCounts(), { commands: 1, changes: 1, receipts: 1, states: 1, outbox: 1 });
    await assert.rejects(reconcileExternalSheetReview(reviewCommand(aliasReview)), /review_revision_conflict/);
    assert.deepEqual(await aliasCounts(), { commands: 1, changes: 1, receipts: 1, states: 1, outbox: 1 });
    assert.deepEqual(await getFormLeadModel().findById(aliasTargetId).lean(), afterPrimary);
    const matchedPrimary = findEquivalentFrozenReview(reviewPlan, aliasReview, afterPrimary, reviewRunId);
    assert.equal(matchedPrimary, primaryReview);
    const ownReviewChanges = await EntityChange.countDocuments({ "entity.id": String(aliasTargetId), "provenance.run_id": reviewRunId });
    assertEquivalentReviewRevision(aliasReview, Number(afterPrimary.domain_revision), ownReviewChanges);
    const primaryReceipt = await SourceRowReceipt.findOne({ _id: receiptId(primaryReview), ingestion_run_id: reviewRunId,
      outcome: "applied", stable_source_row_id: primaryReview.stable_source_row_id, content_hash: primaryReview.cell.source_content_hash,
      resulting_canonical_ids: [String(aliasTargetId)] }).lean();
    assert.ok(primaryReceipt);
    const aliasMetadata = { method: "equivalent_review_alias_v1", primary_stable_source_row_id: primaryReview.stable_source_row_id,
      primary_source_hash: primaryReview.cell.source_content_hash, primary_receipt_id: receiptId(primaryReview), alias_source_hash: aliasReview.cell.source_content_hash,
      primary_raw_value: primaryReview.cell.raw_value, alias_raw_value: aliasReview.cell.raw_value, planned_revision: 3, observed_revision: 4, own_run_changes: ownReviewChanges };
    const aliasReceiptInput = sourceReceipt(aliasReview, "adopted", aliasMetadata);
    assert.equal((await appendSourceReceipt(aliasReceiptInput)).inserted, true);
    // The operator may independently reproject; it coalesces onto the original
    // pending intent and cannot publish another canonical review mutation.
    const projection = { resource: "source_lead", operation: "form_lead.update", leadModel: "FormLead", leadId: String(aliasTargetId) } as const;
    await enqueueSheetSyncJob(projection, { createdBy: "script" });
    assert.deepEqual(await aliasCounts(), { commands: 1, changes: 1, receipts: 2, states: 2, outbox: 1 });
    assert.deepEqual(await getFormLeadModel().findById(aliasTargetId).lean(), afterPrimary);
    assert.deepEqual(await SourceRowReceipt.findById(receiptId(primaryReview)).lean(), primaryReceipt);
    assert.deepEqual(planExpectedSheetTabs("FormLead", afterPrimary).expected.map(tab => tab.tabName), ["Bad Form Leads"]);
    const aliasReceipt = await SourceRowReceipt.findById(receiptId(aliasReview)).select("+workbook_id").lean();
    assert.equal(aliasReceipt?.outcome, "adopted");
    assert.equal(aliasReceipt?.content_hash, aliasReview.cell.source_content_hash);
    assert.deepEqual(aliasReceipt?.matching, aliasMetadata);
    assert.equal(aliasReceipt?.workbook_id, BEST_RELOCATION_TRACKER_ID);
    assert.equal((await appendSourceReceipt(aliasReceiptInput)).inserted, false);
    await enqueueSheetSyncJob(projection, { createdBy: "script" });
    assert.deepEqual(await aliasCounts(), { commands: 1, changes: 1, receipts: 2, states: 2, outbox: 1 });
    assert.deepEqual(await getFormLeadModel().findById(aliasTargetId).lean(), afterPrimary);
    assert.deepEqual(reviewPlan, frozenReviewPlanBefore);
    for (const [field, value] of Object.entries(protectedAliasFields)) assert.deepEqual((afterPrimary as any)[field], value);
    console.log(JSON.stringify({ complete: true, local_replica: "callReportingProof", database,
      proof: ["bad_form_review_precedes_save_visibility_and_outbox", "exclusive_bad_form_destination_before_commit", "normal_form_and_call_booking_gate", "canonical_duplicate_exception", "interrupted_transaction_rollback_and_resume", "same_command_replay_no_new_facts_revisions_or_outbox",
        "second_source_review_reproduces_revision_conflict_without_mutation", "equivalent_review_alias_receipt_only_resume", "exact_alias_receipt_replay_no_new_rows_or_revisions"],
      counts: await counts(), review_alias_counts: await aliasCounts(), review_alias_revision: afterPrimary.domain_revision }));
  } finally {
    mock.restoreAll();
    if (mongoose.connection.host === "127.0.0.1" && mongoose.connection.name === database && /^testvantagemovers_finalimport\d+$/.test(database)) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
