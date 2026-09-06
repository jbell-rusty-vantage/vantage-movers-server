import assert from "node:assert/strict";
import { test } from "node:test";
import { isNoSyncLead, noSyncAppliesToNormalTabs } from "./noSyncLead";

test("isNoSyncLead is false for missing / false / null", () => {
  assert.equal(isNoSyncLead({}), false);
  assert.equal(isNoSyncLead({ no_sync: false }), false);
  assert.equal(isNoSyncLead({ no_sync: null }), false);
  assert.equal(isNoSyncLead({ no_sync: true }), true);
});

test("noSyncAppliesToNormalTabs is false when duplicate or bad_lead", () => {
  assert.equal(noSyncAppliesToNormalTabs({ no_sync: true }), true);
  assert.equal(
    noSyncAppliesToNormalTabs({ no_sync: true, duplicate: false, bad_lead: null }),
    true,
  );
  assert.equal(noSyncAppliesToNormalTabs({ no_sync: true, duplicate: true }), false);
  assert.equal(
    noSyncAppliesToNormalTabs({ no_sync: true, bad_lead: "auto_only" }),
    false,
  );
  assert.equal(noSyncAppliesToNormalTabs({ no_sync: false }), false);
  assert.equal(noSyncAppliesToNormalTabs({}), false);
});
