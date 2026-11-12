const assert = require("node:assert/strict");
const { resolve } = require("node:path");
const test = require("node:test");

// Exercise the emitted JavaScript with synthetic rows. No database or credentials are needed.
const functionDir = process.argv[2] ?? ".vercel/output/functions/api/index.func";
const history = resolve(functionDir, "src/services/granotHistory");
const { supersededObservations } = require(resolve(history, "supersededObservations.js"));
const { prepareClosedRun } = require(resolve(history, "prepareClosedRun.js"));
const targetId = "507f1f77bcf86cd799439011";

for (const [model, collection] of [
  ["FormLead", "form_leads"],
  ["CallLead", "call_leads"],
]) {
  test(`built retention looks up a ${model} and preserves its current observation`, async () => {
    const winner = { observation_id: "current", captured_at: new Date(1) };
    const db = {
      collection(name) {
        assert.equal(name, collection);
        return {
          find({ _id }) {
            const leadIds = _id.$in.map((id) => id.toHexString());
            assert.deepEqual(new Set(leadIds), new Set([targetId]));
            const row = { _id: _id.$in[0], last_accepted_granot_observation: winner };
            return { toArray: async () => [row] };
          },
        };
      },
    };
    const chain = (id, time, target = targetId) => ({
      observation: { _id: id, captured_at: time },
      decisions: [{ target: { model, id: target } }],
    });
    const result = await supersededObservations(db, [
      chain("older", new Date(0)),
      chain(winner.observation_id, winner.captured_at),
      chain("invalid-target", new Date(0), "invalid"),
    ]);
    assert.deepEqual(result, new Set(["older"]));
  });
}

test("built retention looks up the automation run before closing it", async () => {
  const db = {
    collection(name) {
      assert.equal(name, "granot_automation_runs");
      return {
        async findOne({ _id }) {
          assert.equal(_id.toHexString(), targetId);
          return { _id };
        },
      };
    },
  };
  const result = await prepareClosedRun(db, targetId, new Date(0));
  assert.deepEqual(result, { reason: "run_still_present" });
});
