/**
 * MA-02 browser-verification cohort for Move assessment on the local csi01 replica only.
 *
 * Seeds an isolated database with Outreach subjects covering every assessment state the
 * Owner UI must render (scores 100/0, 75 with conditions, 50/50, 25, assessed Unknown,
 * insufficient evidence, pending, not assessed, stale, purged, shadow-only, Lead-only,
 * legacy-run-only, rich inventory/long addresses/conflicts, CRM-closed with history,
 * identity review), running the REAL runtime with a deterministic mocked model. Then
 * publishes one Attention snapshot and prints subject_key → expected scores/status.
 *
 * Zero network and zero real model calls. The URI is hard-coded to loopback.
 *
 *   node --import tsx scripts/dev_ops/seed-csi-move-assessment-demo.ts
 *   MA_DEMO_DATABASE=testvantagemovers_madem1 node --import tsx scripts/dev_ops/seed-csi-move-assessment-demo.ts
 */
import mongoose from "mongoose";

const DATABASE = process.env.MA_DEMO_DATABASE ?? "testvantagemovers_madem0";
const REPLICA = "mongodb://127.0.0.1:27189/?replicaSet=csi01";
if (!/^testvantagemovers_[a-z0-9_]+$/.test(DATABASE)) throw new Error("MA_DEMO_DATABASE must be a testvantagemovers_* database");
Object.assign(process.env, {
  CSI_REPLICA_TEST: "true", TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: DATABASE, MONGO_URI: REPLICA,
  SALES_INTELLIGENCE_DEPLOYMENT_ID: "csi-local-proof", SHEET_SYNC_MODE: "disabled",
  SALES_INTELLIGENCE_ENABLED: "true", SALES_INTELLIGENCE_MOVE_ASSESSMENT: "true", SALES_INTELLIGENCE_EXTRACTION_ENABLED: "false",
  SALES_INTELLIGENCE_CAPTURE_CALL_LOG: "false", SALES_INTELLIGENCE_CAPTURE_WEBHOOK: "false", SALES_INTELLIGENCE_DIRECTORY_SYNC: "false",
  SALES_INTELLIGENCE_MEDIA_ENABLED: "false", SALES_INTELLIGENCE_STT_ENABLED: "false", SALES_INTELLIGENCE_ATTACHMENT_REFRESH: "false",
  SALES_INTELLIGENCE_OUTREACH_ENSURE: "true", SALES_INTELLIGENCE_AUTO_ATTACH: "false", SALES_INTELLIGENCE_LEAD_PROGRESS: "false",
  SALES_INTELLIGENCE_ANALYSIS_PRICING_VERSION: "synthetic", SALES_INTELLIGENCE_ANALYSIS_INPUT_CENTS_PER_MILLION: "1",
  SALES_INTELLIGENCE_ANALYSIS_OUTPUT_CENTS_PER_MILLION: "1", SALES_INTELLIGENCE_EXTRACTION_MODEL: "openai/gpt-5-mini",
  // Empty, not absent: a transitive dotenv/config import must not refill provider credentials from .env.
  AI_GATEWAY_API_KEY: "", PERSONAL_AI_GATEWAY_API_KEY: "", VERCEL_OIDC_TOKEN: "", OPENAI_API_KEY: "",
  RINGCENTRAL_ACCOUNT_ID: "", CRON_SECRET: "synthetic-cron-secret", VANTAGE_API_SECRET: "synthetic-global",
  VANTAGE_ADMIN_PROXY_SIGNING_SECRET: "synthetic-owner-signature",
});

type Tag = "definite_other" | "conditional_75" | "active_50" | "exploring_25" | "unknown_ready" | "insufficient" | "rich";

async function main() {
  globalThis.fetch = (async () => { throw new Error("External traffic forbidden in the Move assessment demo seed"); }) as typeof fetch;
  const { connectMongo, withTransaction } = await import("../../src/db");
  const { getMongoDatabaseName } = await import("../../src/config/domain/runtime");
  const { applyCsiMigration } = await import("../migrations/sales-intelligence.lib");
  const { initializeCsiBudgetPeriod } = await import("../../src/services/salesIntelligence/aiBudget");
  const { getOutreachRecordModel } = await import("../../src/models/OutreachRecord");
  const { getMoveAssessmentArtifactModel } = await import("../../src/models/MoveAssessmentArtifact");
  const { workerContext } = await import("../../src/services/salesIntelligence/outreach/ensure");
  const { createOwnerFollowup } = await import("../../src/services/salesIntelligence/followups/commands");
  const { publishAttentionSnapshot } = await import("../../src/services/salesIntelligence/outreach/attention");
  const runtime = await import("../../src/services/salesIntelligence/assessment/runtime");
  const fx = await import("./csi-move-assessment-fixtures");

  await connectMongo();
  if (getMongoDatabaseName() !== DATABASE) throw new Error("wrong database");
  const db = mongoose.connection.useDb(DATABASE, { useCache: true }).db!;
  if ((await db.admin().command({ hello: 1 })).setName !== "csi01") throw new Error("not the csi01 replica");
  await db.dropDatabase();
  if (!(await applyCsiMigration()).ready) throw new Error("migration not ready");
  const now = new Date(), month = now.toISOString().slice(0, 7);
  await initializeCsiBudgetPeriod({ month, policy_version: "csi-policy-v1", timezone: "UTC", ceiling_cents: 8000,
    period_start: new Date(`${month}-01T00:00:00Z`), period_end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) });

  // ── Deterministic model: the conversation overview carries a [demo:<tag>] marker ──
  const dim = fx.syntheticDimension;
  const decide = (payload: import("../../src/services/salesIntelligence/assessment/context").AssessmentPromptPayload) => {
    const entries = payload.conversations.flatMap(c => c.entries);
    const tag = entries.map(e => /\[demo:([a-z0-9_]+)\]/.exec(e.text)?.[1]).find(Boolean) as Tag | undefined;
    const e = (i: number) => entries[Math.min(i, entries.length - 1)].id;
    const empty = { move_details: [], inventory: { items: [], coverage: "none" as const, limitations: [] }, conflicts: [] };
    switch (tag) {
      case "definite_other": return { ...fx.defaultAssessment(payload), move_likelihood: { ...dim("confirmed", [e(0)]), confidence: "high" },
        transaction_intent: { ...dim("none", [e(1)]), confidence: "high" } };
      case "conditional_75": return { ...fx.defaultAssessment(payload), move_likelihood: dim("strong", [e(0)]),
        transaction_intent: dim("strong", [e(1)], { conditions: ["House sale must close first", "Needs spouse approval"] }) };
      case "active_50": return { ...fx.defaultAssessment(payload), move_likelihood: dim("active", [e(0)]), transaction_intent: dim("active", [e(1)]) };
      case "exploring_25": return { ...empty, move_likelihood: dim("exploring", [e(0)]), transaction_intent: dim("exploring", [e(0)]) };
      case "unknown_ready": return { ...empty, move_likelihood: dim("unknown", [e(0)]), transaction_intent: dim("unknown", []),
        move_details: [{ field: "pickup_location", status: "stated", evidence_ids: [e(0)], value: { line: null, city: "Phoenix", state: "AZ", zip: null, precision: "city" } }] };
      case "insufficient": return { ...empty, move_likelihood: dim("unknown", []), transaction_intent: dim("unknown", []) };
      case "rich": {
        const labels = ["Sectional sofa", "King bed frame", "Dining table", "Six dining chairs", "Upright piano", "Refrigerator", "Washer", "Dryer", "Home office desk", "Treadmill"];
        return {
          move_likelihood: dim("strong", [e(0)]), transaction_intent: dim("active", [e(1)], { conditions: ["Awaiting a written quote"] }),
          move_details: [
            { field: "pickup_location", status: "stated", evidence_ids: [e(0)], value: { line: "12345 North Extraordinarily Long Boulevard Name, Apartment 4521, Building C, Northwest Industrial Park District",
              city: "San Francisco", state: "CA", zip: "94110", precision: "address" } },
            { field: "delivery_location", status: "changed", evidence_ids: [e(1)], value: { line: "987 South Remarkably Lengthy Avenue of the Americas, Suite 3300, Floor 33, Riverside Commons Tower",
              city: "Portland", state: "OR", zip: "97205", precision: "address" } },
            { field: "move_date", status: "changed", evidence_ids: [e(1)], value: { raw_text: "first week of November, maybe earlier", date: "2026-11-02", end_date: "2026-11-06",
              applies_to: "pickup", flexibility: "flexible", precision: "window" } },
            { field: "move_size", status: "stated", evidence_ids: [e(0)], value: { value: { min: 3, max: 3 }, unit: "bedrooms", text: "three bedroom house", basis: "customer_stated" } },
            { field: "service", status: "stated", evidence_ids: [e(0)], value: { service: "packing", status: "requested", detail: "Kitchen and fragile items only", duration_text: null } },
            { field: "access", status: "stated", evidence_ids: [e(1)], value: { end: "delivery", constraint: "elevator", detail: "Freight elevator must be reserved 48 hours ahead" } },
            { field: "money", status: "stated", evidence_ids: [e(1)], value: { basis: "competitor_quote", amount: { min: 4200, max: 4200 }, currency: "USD", text: "Another mover quoted $4,200" } },
          ],
          inventory: { items: labels.map((label, i) => ({ label, quantity: i === 3 ? { min: 6, max: 6 } : i === 9 ? { min: null, max: null } : { min: 1, max: 1 },
            room: i < 2 ? "Living room / primary bedroom" : null, dimensions: i === 4 ? { text: "58 in wide", unit: "in" } : null,
            handling: i === 4 ? "Piano dolly; three movers" : null, status: i === 9 ? "conditional" as const : "included" as const, evidence_ids: [e(i % 2)] })),
          coverage: "partial" as const, limitations: ["Garage contents not discussed"] },
          conflicts: [{ affects: "move_date" as const, explanation: "First call said October 20; the follow-up moved it to early November.", evidence_ids: [e(0), e(1)] },
            { affects: "delivery_location" as const, explanation: "Delivery city changed from Seattle to Portland between calls.", evidence_ids: [e(0), e(1)] }],
        };
      }
      default: return fx.defaultAssessment(payload);
    }
  };
  const mock = await fx.mockAssessmentModel(decide);
  const deps = { model: mock.model, onError: (error: unknown) => console.error(error) };
  const Records = getOutreachRecordModel();

  type Row = { label: string; subject_key: string; record_id: string; expected: string };
  const table: Row[] = [];
  let day = 1;
  const at = () => new Date(Date.UTC(2026, 8, Math.min(day++, 28), 15));
  const nominate = (recordId: string, trigger: string, force = false) =>
    withTransaction(session => runtime.nominateMoveAssessment({ outreach_record_id: recordId, trigger, force }, session));
  async function subject(label: string, model: "FormLead" | "CallLead", fields: Record<string, unknown>,
    calls: Array<{ tag?: Tag; overview: string; said?: string[] }> = [], legacy = false) {
    const number = await fx.seedNumber();
    const lead = await fx.seedLead(model, number.national_ten!, fields);
    const recordId = await fx.seedRecord(lead, String(number._id));
    for (const call of calls) {
      const overview = `${call.tag ? `[demo:${call.tag}] ` : ""}${call.overview}`;
      if (legacy) await fx.seedLegacyConversation(String(number._id), at(), { overview, outcome: "Legacy run outcome retained." });
      else await fx.seedSummaryConversation(String(number._id), at(), { overview, outcome: "Discussed next steps." }, (call.said ?? []).map(claim => ({ claim })));
    }
    return { label, recordId, subject_key: `lead:${model}:${lead.id}`, lead, number };
  }
  async function assess(s: { recordId: string }, trigger: string, extra: Record<string, unknown> = {}) {
    const jobId = await nominate(s.recordId, trigger, Boolean(extra.force));
    if (!jobId) throw new Error(`no nomination for ${trigger}`);
    const result = await runtime.runMoveAssessmentJob(jobId, { ...deps, ...extra });
    if (!["completed", "reused", "shadow_completed", "skipped"].includes(result.status)) throw new Error(`${trigger}: ${JSON.stringify(result)}`);
    return result;
  }
  async function followup(recordId: string, dueInHours: number) {
    await withTransaction(async session => {
      const record = await Records.findById(recordId).session(session).orFail();
      await createOwnerFollowup(record, { kind: "call", description: "Promised callback about the quote", due_at: new Date(Date.now() + dueInHours * 3_600_000).toISOString() },
        workerContext(session, String(new mongoose.Types.ObjectId())));
    });
  }
  const push = (s: { label: string; subject_key: string; recordId: string }, expected: string) => table.push({ label: s.label, subject_key: s.subject_key, record_id: s.recordId, expected });
  const form = (city: string, extra: Record<string, unknown> = {}) => ({ pickup_city: city, pickup_state: "FL", delivery_city: "Atlanta", delivery_state: "GA",
    move_date: new Date("2026-10-20T00:00:00Z"), move_size: "2 Bedroom", ...extra });

  // 1. Definite move, other mover.
  const s1 = await subject("definite_move_other_mover", "FormLead", form("Miami"), [
    { tag: "definite_other", overview: "Customer confirmed the move date.", said: ["We are definitely moving on October 20"] },
    { overview: "Customer called back.", said: ["We already signed with another mover"] }]);
  await assess(s1, "demo:1"); await followup(s1.recordId, -30); push(s1, "ready ML 100 / TI 0 (band via overdue follow-up)");
  // 2. 75 with conditions.
  const s2 = await subject("conditional_75", "FormLead", form("Orlando"), [
    { tag: "conditional_75", overview: "Customer likes the Vantage quote.", said: ["If the house closes we will book with you"] }]);
  await assess(s2, "demo:2"); await followup(s2.recordId, 20); push(s2, "ready ML 75 / TI 75, 2 conditions");
  // 3. 50/50.
  const s3 = await subject("active_50_50", "CallLead", { pickup_city: "Denver", pickup_state: "CO" }, [
    { tag: "active_50", overview: "Customer is comparing proposals.", said: ["We are planning to move this fall"] }]);
  await assess(s3, "demo:3"); push(s3, "ready ML 50 / TI 50 (Call Lead, no band)");
  // 4. 25.
  const s4 = await subject("exploring_25", "CallLead", { pickup_city: "Austin", pickup_state: "TX" }, [
    { tag: "exploring_25", overview: "Customer is just researching prices." }]);
  await assess(s4, "demo:4"); push(s4, "ready ML 25 / TI 25");
  // 5. Assessed Unknown (ready, null scores).
  const s5 = await subject("assessed_unknown", "FormLead", form("Tampa"), [
    { tag: "unknown_ready", overview: "Customer mentioned Phoenix but nothing about timing or plans." }]);
  await assess(s5, "demo:5"); push(s5, "ready ML Unknown / TI Unknown (null scores)");
  // 6. Insufficient evidence.
  const s6 = await subject("insufficient_evidence", "CallLead", { pickup_city: "Reno", pickup_state: "NV" }, [
    { tag: "insufficient", overview: "Call dropped after the greeting." }]);
  await assess(s6, "demo:6"); push(s6, "insufficient_evidence (null scores)");
  // 7. Pending (job queued, not run).
  const s7 = await subject("pending", "FormLead", form("Naples"), [{ overview: "Customer asked for a callback tomorrow.", said: ["Call me tomorrow"] }]);
  await nominate(s7.recordId, "demo:7"); push(s7, "Pending (move_assessment job pending, no artifact)");
  // 8. Not assessed.
  const s8 = await subject("not_assessed", "FormLead", form("Sarasota"), [{ overview: "Customer requested an estimate." }]);
  await followup(s8.recordId, -2); push(s8, "Not assessed (no artifact, no job)");
  // 9. Stale.
  const s9 = await subject("stale", "FormLead", form("Pensacola"), [
    { tag: "active_50", overview: "Customer planning a September move.", said: ["Moving mid September"] }]);
  await assess(s9, "demo:9");
  await withTransaction(session => runtime.markAssessmentStale(s9.recordId, "move_date_window_passed", session)); push(s9, "ready ML 50 / TI 50, stale (move_date_window_passed)");
  // 10. Purged.
  const s10 = await subject("purged", "CallLead", { pickup_city: "Omaha", pickup_state: "NE" }, [
    { tag: "conditional_75", overview: "Customer interested pending approval.", said: ["Need approval first"] }]);
  const purged = await assess(s10, "demo:10");
  await withTransaction(session => runtime.purgeMoveAssessments({ artifact_ids: [purged.artifact_id!] }, new Date(), session));
  push(s10, "purged (projection purged, null scores)");
  // 11. Shadow-only.
  const s11 = await subject("shadow_only", "FormLead", form("Gainesville"), [
    { tag: "active_50", overview: "Backfill candidate with an existing summary.", said: ["We might move in spring"] }]);
  await assess(s11, "backfill:demo", { shadow: true, force: true, credential: "PERSONAL_AI_GATEWAY_API_KEY" }); push(s11, "Not assessed on card (shadow artifact only)");
  // 12. Lead-only Form Lead.
  const s12 = await subject("lead_only", "FormLead", form("Tallahassee", { move_size: "Studio" }));
  await assess(s12, "demo:12"); await followup(s12.recordId, 4); push(s12, "ready lead_only ML 50 / TI Unknown");
  // 13. Legacy-run-only subject.
  const s13 = await subject("legacy_run_only", "CallLead", { pickup_city: "Boise", pickup_state: "ID" }, [
    { tag: "definite_other", overview: "Legacy analysis only: customer booked elsewhere." }], true);
  await assess(s13, "demo:13"); push(s13, "ready from legacy run ML 100 / TI 0");
  // 14. Rich inventory, long addresses, conflicts.
  const s14 = await subject("rich_inventory_conflicts", "FormLead", form("San Francisco", { pickup_state: "CA", delivery_city: "Seattle", delivery_state: "WA",
    ingestion_origin: "wordpress_form", ingested_move_snapshot: { pickup_city: "San Francisco", pickup_state: "CA", delivery_city: "Seattle", delivery_state: "WA",
      move_date: new Date("2026-10-20T00:00:00Z"), move_size: "2 Bedroom", captured_at: new Date("2026-09-01T12:00:00Z"), evidence_status: "captured_at_ingestion" } }), [
    { tag: "rich", overview: "Customer listed furniture room by room; moving to Seattle around October 20.", said: ["Sectional sofa, king bed, dining table and six chairs", "An upright piano"] },
    { overview: "Follow-up: destination changed to Portland and the date moved to early November.", said: ["Actually Portland, first week of November", "Another mover quoted 4200"] }]);
  await assess(s14, "demo:14"); await followup(s14.recordId, -80); push(s14, "ready ML 75 / TI 50, 10 items, 2 conflicts, long addresses");
  // 15. CRM-closed with a historical ready artifact.
  const s15 = await subject("crm_closed_with_history", "FormLead", form("Jacksonville"), [
    { tag: "conditional_75", overview: "Customer was close to booking before going quiet.", said: ["Probably booking next week"] }]);
  await assess(s15, "demo:15");
  await Records.collection.updateOne({ _id: new mongoose.Types.ObjectId(s15.recordId) }, { $set: { state: "closed", closure_origin: "crm_disposition",
    closed_reason: "granot_dead_opportunity", closed_at: new Date() } });
  push(s15, "closed (crm_disposition); historical ready ML 75 / TI 75, Not applicable");
  // 16. Identity review (prior ready artifact, then ambiguous).
  const s16 = await subject("identity_review", "CallLead", { pickup_city: "Mobile", pickup_state: "AL" }, [
    { tag: "active_50", overview: "Caller identity unclear between two Leads.", said: ["My husband filled the form"] }]);
  await assess(s16, "demo:16");
  await Records.collection.updateOne({ _id: new mongoose.Types.ObjectId(s16.recordId) }, { $set: { state: "identity_review", state_before_identity_review: "unworked" } });
  await assess(s16, "demo:16-review");
  push(s16, "identity_review; ambiguous_subject artifact recorded, prior projection kept");

  const snapshot = await publishAttentionSnapshot();
  const records = await Records.find({ _id: { $in: table.map(r => r.record_id) } }).lean();
  const artifacts = await getMoveAssessmentArtifactModel().find({}).select("subject_key status shadow").lean();
  console.log(`\nMove assessment demo cohort: database ${DATABASE} (loopback csi01). Model calls: ${mock.calls()} (mocked). Snapshot: ${JSON.stringify(snapshot).slice(0, 200)}\n`);
  const rows = table.map(row => {
    const record = records.find(r => String(r._id) === row.record_id);
    const projection = record?.move_assessment;
    const own = artifacts.filter(a => a.subject_key === row.subject_key).map(a => `${a.status}${a.shadow ? "(shadow)" : ""}`).join(",") || "-";
    return { label: row.label, subject_key: row.subject_key, state: record?.state, projection: projection ? `${projection.status} ML=${projection.move_likelihood ?? "null"} TI=${projection.transaction_intent ?? "null"}${projection.stale ? " stale" : ""}` : "none",
      artifacts: own, expected: row.expected };
  });
  console.table(rows);
  await mongoose.disconnect();
}
main().then(() => process.exit(0)).catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exit(1); });
