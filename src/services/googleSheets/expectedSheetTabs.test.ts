import assert from "node:assert/strict";
import { test } from "node:test";
import { SHEET_TAB_NAMES } from "../../config/domain";
import { planExpectedSheetTabs } from "./expectedSheetTabs";

test("Form Lead that is not a Duplicate Lead expects Master Leads Forms", () => {
  const plan = planExpectedSheetTabs("FormLead", { duplicate: false });
  assert.deepEqual(
    plan.expected.map((tab) => tab.tabName),
    [SHEET_TAB_NAMES.forms],
  );
  assert.deepEqual(
    plan.siblings.map((tab) => tab.tabName),
    [SHEET_TAB_NAMES.duplicates, SHEET_TAB_NAMES.badLeads],
  );
});

test("Duplicate Form Lead expects Master Leads Duplicates", () => {
  const plan = planExpectedSheetTabs("FormLead", { duplicate: true });
  assert.deepEqual(
    plan.expected.map((tab) => tab.tabName),
    [SHEET_TAB_NAMES.duplicates],
  );
  assert.ok(plan.siblings.some((tab) => tab.tabName === SHEET_TAB_NAMES.forms));
});

test("Bad Lead expects the primary tab and Bad Leads", () => {
  const plan = planExpectedSheetTabs("FormLead", {
    duplicate: false,
    bad_lead: "disconnected_number",
  });
  assert.deepEqual(
    plan.expected.map((tab) => tab.tabName),
    [SHEET_TAB_NAMES.forms, SHEET_TAB_NAMES.badLeads],
  );
  assert.deepEqual(
    plan.siblings.map((tab) => tab.tabName),
    [SHEET_TAB_NAMES.duplicates],
  );
});

test("Call Lead that is not a Duplicate Lead expects Master Leads Calls", () => {
  const plan = planExpectedSheetTabs("CallLead", { duplicate: false });
  assert.deepEqual(
    plan.expected.map((tab) => tab.tabName),
    [SHEET_TAB_NAMES.calls],
  );
  assert.deepEqual(
    plan.siblings.map((tab) => tab.tabName),
    [SHEET_TAB_NAMES.duplicateCalls],
  );
});

test("Duplicate Call Lead expects Master Leads Duplicate Calls", () => {
  const plan = planExpectedSheetTabs("CallLead", { duplicate: true });
  assert.deepEqual(
    plan.expected.map((tab) => tab.tabName),
    [SHEET_TAB_NAMES.duplicateCalls],
  );
  assert.deepEqual(
    plan.siblings.map((tab) => tab.tabName),
    [SHEET_TAB_NAMES.calls],
  );
});

test("Unmatched Call Lead is not expected on Master Leads", () => {
  const plan = planExpectedSheetTabs("CallLead", { created_on_unmatched: true });
  assert.deepEqual(plan.expected, []);
  assert.equal(plan.skipReason, "created_on_unmatched");
});

test("ordinary No-Sync Form Lead skips Master Leads with no_sync", () => {
  const plan = planExpectedSheetTabs("FormLead", { no_sync: true, duplicate: false });
  assert.deepEqual(plan.expected, []);
  assert.deepEqual(plan.siblings, []);
  assert.equal(plan.skipReason, "no_sync");
});

test("ordinary No-Sync Call Lead skips Master Leads with no_sync", () => {
  const plan = planExpectedSheetTabs("CallLead", { no_sync: true, duplicate: false });
  assert.deepEqual(plan.expected, []);
  assert.equal(plan.skipReason, "no_sync");
});

test("No-Sync + Bad Lead still expects today's Bad tabs", () => {
  const plan = planExpectedSheetTabs("FormLead", {
    no_sync: true,
    duplicate: false,
    bad_lead: "disconnected_number",
  });
  assert.equal(plan.skipReason, undefined);
  assert.deepEqual(
    plan.expected.map((tab) => tab.tabName),
    [SHEET_TAB_NAMES.forms, SHEET_TAB_NAMES.badLeads],
  );
});

test("No-Sync + Duplicate Call Lead still expects Duplicate Calls", () => {
  const plan = planExpectedSheetTabs("CallLead", {
    no_sync: true,
    duplicate: true,
  });
  assert.equal(plan.skipReason, undefined);
  assert.deepEqual(
    plan.expected.map((tab) => tab.tabName),
    [SHEET_TAB_NAMES.duplicateCalls],
  );
});

test("Booking expects Master Booked Booked Deals", () => {
  const plan = planExpectedSheetTabs("BookedLead");
  assert.deepEqual(
    plan.expected.map((tab) => [tab.workbookTitle, tab.tabName]),
    [["Master Booked", SHEET_TAB_NAMES.bookedDeals]],
  );
  assert.deepEqual(plan.siblings, []);
});

test("Cancellation expects Master Booked Cancelled Deals", () => {
  const plan = planExpectedSheetTabs("CancelledLead");
  assert.deepEqual(
    plan.expected.map((tab) => [tab.workbookTitle, tab.tabName]),
    [["Master Booked", SHEET_TAB_NAMES.cancelledDeals]],
  );
});
