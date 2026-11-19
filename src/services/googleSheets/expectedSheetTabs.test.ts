import assert from "node:assert/strict";
import { test } from "node:test";
import { SHEET_TAB_NAMES } from "../../config/domain";
import { planExpectedSheetTabs } from "./expectedSheetTabs";

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
