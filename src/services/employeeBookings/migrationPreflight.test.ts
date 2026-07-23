import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildEmployeeBookingMigrationReport,
  collectNormalizedCollisions,
  reportHasBlockingCollisions,
} from "./migrationPreflight";

test("collectNormalizedCollisions groups normalized duplicates", () => {
  const collisions = collectNormalizedCollisions(
    [
      { _id: "1", value: "A-1" },
      { _id: "2", value: "A 1" },
      { _id: "3", value: "B-2" },
    ],
    (doc) => doc.value.replace(/[-\s]/g, ""),
  );
  assert.deepEqual(collisions, [{ normalized: "A1", ids: ["1", "2"] }]);
});

test("reportHasBlockingCollisions flags booking identity collisions", () => {
  const report = buildEmployeeBookingMigrationReport({
    bookedLeads: [
      {
        _id: "1",
        job_no: "J-1",
        submission_id: "sub-1",
        booking_origin: "employee_booking",
      },
      {
        _id: "2",
        job_no: "J 1",
        submission_id: "sub-1",
        booking_origin: "employee_booking",
      },
    ],
    callLeads: [],
    formLeads: [],
    sourceCompanies: [],
  });
  assert.equal(report.bookedLeadJobNoCollisions.length, 1);
  assert.equal(report.bookedLeadSubmissionIdCollisions.length, 1);
  assert.equal(reportHasBlockingCollisions(report), true);
});

test("submission collision preflight ignores bookings outside the partial unique index scope", () => {
  const report = buildEmployeeBookingMigrationReport({
    bookedLeads: [
      { _id: "1", job_no: "J-1", submission_id: "sub-1", booking_origin: "employee_booking" },
      { _id: "2", job_no: "J-2", submission_id: "sub-1", booking_origin: "manual" },
    ],
    callLeads: [],
    formLeads: [],
    sourceCompanies: [],
  });

  assert.deepEqual(report.bookedLeadSubmissionIdCollisions, []);
});
