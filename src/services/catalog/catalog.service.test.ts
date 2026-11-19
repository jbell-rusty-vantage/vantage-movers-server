import assert from "node:assert/strict";
import { test } from "node:test";
import { Agent } from "../../models/Agent";
import { resolveActiveAgentByName, resolveAgentByName } from "./catalog.service";

test("a former Agent remains available for historical attribution and is refused for active assignment", async (t) => {
  const former = { _id: "former-agent", name: "Former Agent", normalized_name: "former agent", active: false };
  t.mock.method(Agent, "findOne", (filter: { active?: boolean; $or: unknown[] }) => {
    assert.deepEqual(filter.$or, [{ normalized_name: "former agent" }, { name_aliases: "former agent" }]);
    return { exec: async () => filter.active === true ? null : former };
  });

  await assert.rejects(resolveActiveAgentByName("Former Agent"), /Unknown or inactive agent/);
  const historical = await resolveAgentByName("Former Agent", { includeInactive: true });
  assert.equal(historical.name, former.name);
  assert.equal(historical.active, false);
});
