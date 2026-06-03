import assert from "node:assert/strict";
import { test } from "node:test";
import { CALL_SHEET_HEADERS, SHEET_TAB_NAMES } from "../../config/domain";
import {
  getEnsureTabsForSyncTarget,
  getHeadersForSyncTarget,
  getMasterLeadsTabs,
} from "./targets";

test("Master Leads provisions a dedicated Duplicate Calls tab", () => {
  const tabNames = getMasterLeadsTabs().map((tab) => tab.tabName);
  assert.ok(tabNames.includes(SHEET_TAB_NAMES.duplicateCalls));
  assert.equal(SHEET_TAB_NAMES.duplicateCalls, "Duplicate Calls");
});

test("Duplicate Calls tab reuses the Calls headers", () => {
  const duplicateTab = getMasterLeadsTabs().find(
    (tab) => tab.tabName === SHEET_TAB_NAMES.duplicateCalls,
  );
  assert.deepEqual(duplicateTab?.headers, CALL_SHEET_HEADERS);
});

test("duplicate-call sync targets resolve to the Calls headers", () => {
  assert.equal(getHeadersForSyncTarget("master_duplicate_calls"), CALL_SHEET_HEADERS);
  assert.equal(getHeadersForSyncTarget("source_duplicate_calls"), CALL_SHEET_HEADERS);
});

test("duplicate-call master target ensures the Master Leads tab set", () => {
  const tabNames = getEnsureTabsForSyncTarget("master_duplicate_calls").map(
    (tab) => tab.tabName,
  );
  assert.ok(tabNames.includes(SHEET_TAB_NAMES.duplicateCalls));
  assert.ok(tabNames.includes(SHEET_TAB_NAMES.calls));
});
