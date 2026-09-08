import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { CallLead } from "../../models/CallLead";
import { V1ServiceError } from "../v1ServiceError";
import { resolveBookingSourceLead } from "./bookingSourceResolver";

const originalFind = CallLead.find;
const originalCreate = CallLead.create;

afterEach(() => {
  (CallLead as any).find = originalFind;
  (CallLead as any).create = originalCreate;
});

function jobQuery(docs: unknown[]) {
  return {
    sort() {
      return this;
    },
    limit() {
      return this;
    },
    then(resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve(docs).then(resolve, reject);
    },
  };
}

test("import Call Lead resolver still 409s when two Call Leads share a job", async () => {
  (CallLead as any).find = () =>
    jobQuery([
      { _id: "1", job_no: "P100" },
      { _id: "2", job_no: "P100" },
    ]);

  await assert.rejects(
    () =>
      resolveBookingSourceLead({
        lead_type: "CallLead",
        call_job_no: "P100",
        book_date: new Date("2026-05-21T00:00:00.000Z"),
        agent: "JOSH",
        binder_amount: 900,
        deposit_amount: 900,
        merchant: "Card",
        ingestion_source: "best_relocation_sheet",
      } as any),
    (error: unknown) =>
      error instanceof V1ServiceError && error.statusCode === 409,
  );
});
