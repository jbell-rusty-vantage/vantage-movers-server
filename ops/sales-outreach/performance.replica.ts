import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";

const database = `testvantagemovers_performance${randomUUID().replaceAll("-", "")}`;
for (const key of Object.keys(process.env))
  if (
    /RINGCENTRAL|^RC_|BLOB|GATEWAY|OPENAI|ANTHROPIC|VERCEL|KV_REST|REDIS|UPSTASH|QSTASH|GOOGLE|MONGO|DOTENV/i.test(
      key,
    )
  )
    delete process.env[key];
process.env.DOTENV_CONFIG_PATH = `${__dirname}/.performance-no-dotenv.env`;
if (process.argv.length !== 2)
  throw new Error("Local performance replica proof accepts no arguments");
process.env.MONGO_URI = "mongodb://127.0.0.1:27204/?replicaSet=performance01";
process.env.TEST_MODE = "true";
process.env.TEST_MONGO_DATABASE_NAME = database;
process.env.SHEET_SYNC_MODE = "disabled";
async function main() {
  const { connectMongo, withTransaction } = await import("../../src/db.js");
  const {
    getSalesOutreachPerformancePolicyModel,
    getSalesOutreachSmsRequirementDayModel,
    getSalesOutreachSmsVolumeContributionModel,
  } = await import("../../src/models/salesOutreach/performance.js");
  const { getRingCentralRepSmsEvidenceModel } =
    await import("../../src/models/salesOutreach/repSmsEvidence.js");
  const { retainSmsRequirementGap, retainSmsRequirements, retainSmsVolume } =
    await import("../../src/services/salesOutreach/performance/evidence.js");
  const { mongoContactEventStore } =
    await import("../../src/services/salesOutreach/contacts/mongoStore.js");
  const { POLICY, scenario, periods, ny, sms } =
    await import("../../src/services/salesOutreach/engine/testSupport.js");
  const { evaluateSubject } =
    await import("../../src/services/salesOutreach/engine/index.js");
  await connectMongo();
  const Req = getSalesOutreachSmsRequirementDayModel(),
    Vol = getSalesOutreachSmsVolumeContributionModel(),
    Sms = getRingCentralRepSmsEvidenceModel();
  for (const Model of [Req, Vol, Sms, getSalesOutreachPerformancePolicyModel()])
    await Model.createIndexes();
  const sender = new mongoose.Types.ObjectId();
  const source = await Sms.create({
    provider_account_id: "replica",
    owning_extension_id: "1",
    message_id: "1",
    canonical_logical_id: "replica:1",
    direction: "outbound",
    status: "sent",
    credit_effect: "credit",
    provider_created_at: new Date(ny("2026-10-05", "10:00")),
    send_at: new Date(ny("2026-10-05", "10:00")),
    reviewed_rep_ref: {
      agent_id: sender,
      link_id: new mongoose.Types.ObjectId(),
    },
    identity_state: "reviewed",
    captured_at: new Date(),
    last_sync_kind: "FSync",
  });
  const writeVolume = () =>
    withTransaction(async (session) =>
      retainSmsVolume(
        await mongoContactEventStore.loadSms([String(source._id)], session),
        session,
      ),
    );
  await writeVolume();
  await writeVolume();
  assert.equal(await Vol.countDocuments(), 1);
  assert.equal((await Vol.findOne().lean())!.revision, 1);
  await Sms.updateOne(
    { _id: source._id },
    { $set: { status: "delivery_failed" }, $inc: { source_revision: 1 } },
  );
  await writeVolume();
  assert.equal((await Vol.findOne().lean())!.disposition, "excluded");
  const input = scenario({
    periods: periods(["p1", "new", ny("2026-08-03", "09:00"), "intake"]),
    events: [sms(ny("2026-08-03", "10:00"), { agent: "helper", id: String(source._id) })],
  });
  let asOf = ny("2026-08-03", "22:00");
  const persist = async (policy = POLICY, mark = "original") => {
    const result = evaluateSubject(input, policy, asOf);
    await withTransaction((session) =>
      retainSmsRequirements(input, result, policy, mark, session),
    );
    return result;
  };
  await persist();
  const original = await Req.findOne({ business_date: "2026-08-03" }).lean();
  assert.ok(original);
  assert.equal(original.obligations[0]!.responsible_agent_id, "alice");
  assert.equal(original.obligations[0]!.outcome, "fulfilled");
  await persist();
  assert.equal(
    (await Req.findById(original._id).lean())!.revision,
    original.revision,
  );
  asOf = ny("2026-10-15", "22:00");
  const later = await persist();
  assert.ok(
    !later.window_history.some((day) => day.business_date === "2026-08-03"),
  );
  assert.ok(await Req.findById(original._id));
  assert.equal(
    (await Req.findById(original._id).lean())!.revision,
    original.revision,
  );
  const changedPolicy = {
    ...POLICY,
    new_cadence: { ...POLICY.new_cadence, sms_initial_days: [] },
  };
  await persist(changedPolicy, "changed");
  assert.deepEqual(
    (await Req.findById(original._id).lean())!.obligations,
    original.obligations,
  );
  const { getSalesOutreachContactEventModel } = await import("../../src/models/salesOutreach/contactEvents.js");
  // A synthetic globally retained event moved to another subject must revoke the former fulfillment.
  await getSalesOutreachContactEventModel().collection.insertOne({ _id: new mongoose.Types.ObjectId(), source_kind: "sms", source_id: source._id, subject_id: new mongoose.Types.ObjectId() });
  input.contact_events = [];
  await persist();
  assert.equal((await Req.findById(original._id).lean())!.obligations[0]!.outcome, "missed");
  input.periods = [];
  await persist();
  assert.equal(await Req.findById(original._id).lean(), null);
  assert.equal(
    await getSalesOutreachPerformancePolicyModel().countDocuments(),
    2,
  );
  const { mongoEvaluationStore } =
    await import("../../src/services/salesOutreach/evaluation/store.js");
  const { evaluateAndProject, evaluationAdmissionOf } =
    await import("../../src/services/salesOutreach/evaluation/evaluateJob.js");
  const {
    MemoryEvaluationStore,
    subjectRow,
    periodRow,
    completeConfigurationInput,
  } = await import("../../src/services/salesOutreach/evaluation/testing.js");
  const { activeInspection } =
    await import("../../src/services/salesOutreach/reads/testing.js");
  const memory = new MemoryEvaluationStore();
  const subject = subjectRow();
  memory.subjects.set(subject.id, subject);
  memory.periods = [periodRow(subject.id)];
  const admission = evaluationAdmissionOf(
    activeInspection(
      completeConfigurationInput({
        cadence_shadow_enabled: true,
        rep_sms_capture_enabled: true,
      }),
    ),
  );
  if (!admission.ok) throw new Error(admission.status);
  const methods = [
    "loadSubject",
    "loadPeriods",
    "loadPlans",
    "loadRestrictions",
    "loadAssignmentChanges",
    "loadRepLinks",
    "loadContactEvents",
    "loadCoverage",
    "readProjection",
    "insertProjection",
    "updateProjection",
  ] as const;
  const originalMethods = Object.fromEntries(
    methods.map((key) => [key, Reflect.get(mongoEvaluationStore, key)]),
  );
  for (const key of methods)
    Object.defineProperty(mongoEvaluationStore, key, {
      value: Reflect.get(memory, key).bind(memory),
      writable: true,
      configurable: true,
    });
  try {
    const at = new Date(ny("2026-10-05", "22:00"));
    await withTransaction((session) =>
      evaluateAndProject(
        subject.id,
        admission.context,
        at,
        mongoEvaluationStore,
        session,
      ),
    );
    await Req.deleteMany({ subject_id: subject.id });
    const replay = await withTransaction((session) =>
      evaluateAndProject(
        subject.id,
        admission.context,
        at,
        mongoEvaluationStore,
        session,
      ),
    );
    assert.equal(replay.outcome, "unchanged");
    assert.ok(await Req.exists({ subject_id: subject.id }));
    await withTransaction((session) =>
      retainSmsRequirementGap(
        subject.id,
        "2026-10-05",
        admission.context.policy,
        admission.context.policy_fingerprint,
        session,
      ),
    );
    assert.equal(
      await Req.exists({ subject_id: subject.id, input_complete: true }),
      null,
    );
    const Policy = getSalesOutreachPerformancePolicyModel();
    const sharedPolicyBefore = await Policy.findOne({
      policy_fingerprint: admission.context.policy_fingerprint,
    }).lean();
    assert.ok(sharedPolicyBefore);
    const policyBytesBefore = JSON.stringify(sharedPolicyBefore);
    const concurrentSubjects = Array.from({ length: 4 }, () => subjectRow());
    for (const independentSubject of concurrentSubjects) {
      memory.subjects.set(independentSubject.id, independentSubject);
      memory.periods.push(periodRow(independentSubject.id));
    }
    for (let pass = 0; pass < 2; pass++) {
      const results: PromiseSettledResult<Awaited<ReturnType<typeof evaluateAndProject>>>[] = await Promise.allSettled(concurrentSubjects.map((independentSubject) =>
        withTransaction((session) => evaluateAndProject(
          independentSubject.id, admission.context, at, mongoEvaluationStore, session,
        )),
      ));
      for (const result of results) {
        if (result.status === "rejected") throw result.reason;
        assert.equal(result.value.outcome, pass === 0 ? "created" : "unchanged");
      }
    }
    for (const independentSubject of concurrentSubjects)
      assert.ok(await Req.exists({ subject_id: independentSubject.id, input_complete: true }));
    const sharedPolicyAfter = await Policy.findOne({
      policy_fingerprint: admission.context.policy_fingerprint,
    }).lean();
    assert.ok(sharedPolicyAfter);
    assert.equal(sharedPolicyAfter.updatedAt.toISOString(), sharedPolicyBefore.updatedAt.toISOString());
    assert.equal(JSON.stringify(sharedPolicyAfter), policyBytesBefore);
  } finally {
    Object.assign(mongoEvaluationStore, originalMethods);
  }
  console.log(
    JSON.stringify({
      passed: true,
      proofs: [
        "logical replay",
        "status reversal",
        "unassociated volume",
        "helper responsibility",
        "history beyond 30 dates",
        "frozen policy",
        "obsolete slots",
        "reassociation revokes old fulfillment",
        "evaluator no-op materialization",
        "capped input gap",
        "four concurrent subjects share immutable policy across replay",
      ],
    }),
  );
}
main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (
      mongoose.connection.readyState === 1 &&
      mongoose.connection.name === database
    )
      await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
