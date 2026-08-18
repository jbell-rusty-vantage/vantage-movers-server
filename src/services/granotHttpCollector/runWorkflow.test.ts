import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { Types } from "mongoose";
import { computeChecksum } from "../durableWork";
import {
  buildFormExpectedFilter,
  createGranotRunGroup,
  toDurableGranotValue,
  type GranotRunGroupRuntime,
} from "./runWorkflow";
import {
  GranotAutomationSourceValidationError,
  type GranotAutomationSourceItem,
} from "./sourceCatalog";

const actor = {
  actor_type: "owner",
  actor_id: "owner-1",
  actor_label: "Owner",
  actor_role: "owner",
  request_id: "request-1",
  origin: "vantage_admin",
} as const;

const formSource: GranotAutomationSourceItem = {
  id: "507f1f77bcf86cd799439011",
  label: "Form Source",
  active: true,
  supported_operations: ["form_leads"],
  created_from: "seed",
};
const callSource: GranotAutomationSourceItem = {
  id: "507f1f77bcf86cd799439012",
  label: "Call Source",
  active: true,
  supported_operations: ["call_leads"],
  created_from: "seed",
};

test("run-group creation inserts two correlated compatible queued children", async () => {
  let insertedDocuments: Parameters<GranotRunGroupRuntime["insertRuns"]>[0] = [];
  const runtime: GranotRunGroupRuntime = {
    resolveSources: async () =>
      new Map([
        ["form_leads", [formSource]],
        ["call_leads", [callSource]],
      ]),
    insertRuns: async (documents) => {
      insertedDocuments = documents;
      return documents.map((document, index) => ({
        ...document,
        _id: `run-${index + 1}`,
      }));
    },
    // A failed wake-up must not roll back the recoverable queued documents.
    publishWakeup: async () => false,
  };

  const result = await createGranotRunGroup(
    {
      operations: ["form_leads", "call_leads"],
      workflow: "apply",
      dateWindow: { from: "08/01/2026", to: "08/05/2026" },
      sourceIds: [formSource.id, callSource.id],
      initiator: actor,
    },
    runtime,
  );

  assert.equal(insertedDocuments.length, 2);
  assert.equal(
    insertedDocuments[0]?.run_group_id,
    insertedDocuments[1]?.run_group_id,
  );
  assert.ok(insertedDocuments[0]?.run_group_id);
  assert.deepEqual(insertedDocuments[0]?.request_snapshot.sourceIds, [
    formSource.id,
  ]);
  assert.deepEqual(insertedDocuments[0]?.request_snapshot.sourceLabels, [
    formSource.label,
  ]);
  assert.deepEqual(insertedDocuments[1]?.request_snapshot.sourceIds, [
    callSource.id,
  ]);
  assert.deepEqual(insertedDocuments[1]?.request_snapshot.sourceLabels, [
    callSource.label,
  ]);
  assert.deepEqual(
    insertedDocuments.map((document) => document.status),
    ["queued", "queued"],
  );
  assert.equal(result.run_group_id, insertedDocuments[0]?.run_group_id);
  assert.deepEqual(
    result.runs.map((run) => run.queue_published),
    [false, false],
  );
});

test("run-group validation completes before any child insertion", async () => {
  let insertCalled = false;
  const runtime: GranotRunGroupRuntime = {
    resolveSources: async () => {
      throw new GranotAutomationSourceValidationError(
        "No selected sources support call_leads.",
        [{
          path: ["source_ids"],
          message: "Select at least one source that supports call_leads",
        }],
      );
    },
    insertRuns: async () => {
      insertCalled = true;
      return [];
    },
    publishWakeup: async () => true,
  };

  await assert.rejects(
    () =>
      createGranotRunGroup(
        {
          operations: ["form_leads", "call_leads"],
          workflow: "preview",
          dateWindow: { from: "08/01/2026", to: "08/05/2026" },
          sourceIds: [formSource.id],
          initiator: actor,
        },
        runtime,
      ),
    GranotAutomationSourceValidationError,
  );
  assert.equal(insertCalled, false);
});

test("call plan previews convert Mongo ObjectIds before checksumming", () => {
  const sourceCompanyId = new Types.ObjectId();
  const preview = toDurableGranotValue({
    status: "updateable",
    optional_match: undefined,
    parsed: {
      optional_booking: undefined,
      source_assignment: {
        lead_source_company: sourceCompanyId,
      },
    },
    candidates: [undefined, sourceCompanyId],
  });

  assert.deepEqual(preview, {
    status: "updateable",
    parsed: {
      source_assignment: {
        lead_source_company: sourceCompanyId.toHexString(),
      },
    },
    candidates: [null, sourceCompanyId.toHexString()],
  });
  assert.doesNotThrow(() =>
    computeChecksum({
      checksum_version: 1,
      artifact_kind: "ingestion_plan",
      schema_version: 1,
      payload: preview,
    }),
  );
});

test("form expected filters do not cast empty strings as ObjectIds", () => {
  assert.deepEqual(
    buildFormExpectedFilter({
      receiver_agent: null,
      pickup_city: null,
    }),
    {
      receiver_agent: null,
      pickup_city: { $in: [null, ""] },
    },
  );
});

test("[AC-02] applyRun has no runtime path to legacy Form/Call/Booked mutation services", async () => {
  const source = await readFile(
    path.join(__dirname, "runWorkflow.ts"),
    "utf8",
  );
  assert.equal(source.includes("updateFormLead"), false);
  assert.equal(source.includes("syncCallLeadEnrichment"), false);
  assert.equal(source.includes("syncBookedCallLeadReconciliation"), false);
  assert.match(source, /applyAutomationPlanAction/);
  assert.match(source, /claimAndProcessOrPoll|applyAutomationPlanAction/);
});
