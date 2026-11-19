import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, test } from "node:test";
import express from "express";
import mongoose from "mongoose";
import { GRANOT_LIFECYCLE_ERROR_CODES } from "../services/granotLifecycle/errors";
import type {
  ApplyExtensionGranotItemInput,
  ExtensionGranotApplyResult,
} from "../services/granotLifecycle/extensionApply";
import { createExtensionGranotApplyRouter } from "./extension-granot-apply.routes";

const formId = new mongoose.Types.ObjectId().toHexString();
const applied: ApplyExtensionGranotItemInput[] = [];
let applyImpl: (
  input: ApplyExtensionGranotItemInput,
) => Promise<ExtensionGranotApplyResult> = async (input) => {
  applied.push(input);
  return {
    operation_id: input.item.operation_id,
    receipt_id: "receipt-1",
    processing_state: "completed",
    outcome: "already_current",
    changed_paths: [],
    message: "Already current",
  };
};

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const role = req.header("x-test-role");
  if (
    role === "owner" ||
    role === "employee" ||
    role === "sales" ||
    role === "customer_service"
  ) {
    const roles =
      role === "employee"
        ? (["sales", "customer_service"] as const)
        : role === "owner"
          ? (["owner"] as const)
          : role === "sales"
            ? (["sales"] as const)
            : (["customer_service"] as const);
    (req as express.Request & {
      vantageAuth?: { kind: "user"; userId: string; email: string; roles: readonly string[] };
    }).vantageAuth = {
      kind: "user",
      userId: "user-1",
      email: "owner@example.invalid",
      roles: [...roles],
    };
  } else if (role === "secret") {
    (req as express.Request & { vantageAuth?: { kind: "secret" } }).vantageAuth = {
      kind: "secret",
    };
  }
  next();
});
app.use(
  createExtensionGranotApplyRouter({
    connect: async () => undefined,
    applyItem: (input) => applyImpl(input),
  }),
);

let baseUrl = "";
let server: ReturnType<typeof app.listen>;

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error?: Error) => (error ? reject(error) : resolve())),
  );
});

afterEach(() => {
  applied.length = 0;
  applyImpl = async (input) => {
    applied.push(input);
    return {
      operation_id: input.item.operation_id,
      receipt_id: "receipt-1",
      processing_state: "completed",
      outcome: "already_current",
      changed_paths: [],
      message: "Already current",
    };
  };
});

const operationId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function snapshotItem(overrides: Record<string, unknown> = {}) {
  return {
    operation_id: operationId,
    operation_kind: "lead_snapshot_apply",
    granot_statement: {
      source: "Synthetic Forms",
      priority: "1",
      user: "MIKE",
      rep: "SALES",
    },
    expected_target: { model: "FormLead", id: formId },
    ...overrides,
  };
}

async function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = { "x-test-role": "owner" },
) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function patch(
  path: string,
  body: unknown,
  headers: Record<string, string> = { "x-test-role": "owner" },
) {
  return fetch(`${baseUrl}${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("[AC-33] Owner Form apply captures a statement and never a quoted patch", async () => {
  const response = await patch(`/api/v1/form-leads/${formId}/granot-sync`, snapshotItem());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(applied.length, 1);
  assert.equal(applied[0]?.initiator.origin, "browser_extension");
  assert.equal(applied[0]?.initiator.actor_role, "owner");
  assert.equal(applied[0]?.item.granot_statement.priority, "1");
  assert.equal("quoted" in applied[0]!.item, false);
});

test("[AC-35] Admin, secret, and unauthenticated apply create no receipt", async () => {
  const denied: Record<string, string>[] = [
    {},
    { "x-test-role": "employee" },
    { "x-test-role": "sales" },
    { "x-test-role": "customer_service" },
    { "x-test-role": "secret" },
  ];
  for (const headers of denied) {
    const response = await patch(
      `/api/v1/form-leads/${formId}/granot-sync`,
      snapshotItem(),
      headers,
    );
    const body = await response.json();
    assert.equal(response.status, 403);
    assert.equal(body.code, GRANOT_LIFECYCLE_ERROR_CODES.OWNER_REQUIRED);
    assert.equal(applied.length, 0);
    assert.equal(JSON.stringify(body).includes("MIKE"), false);
  }
});

test("[AC-33] Call enrichment accepts a bounded batch in input order and rejects duplicate operation IDs", async () => {
  const first = "11111111-1111-4111-8111-111111111111";
  const second = "22222222-2222-4222-8222-222222222222";
  const response = await post("/api/v1/call-leads/enrichment/sync", {
    items: [
      {
        operation_id: first,
        operation_kind: "lead_snapshot_apply",
        granot_statement: { source: "Synthetic Calls", priority: "1", user: "A", rep: "B" },
      },
      {
        operation_id: second,
        operation_kind: "lead_snapshot_apply",
        granot_statement: { source: "Synthetic Calls", priority: "5", user: "C", rep: "D" },
      },
    ],
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(
    body.data.map((row: { operation_id: string }) => row.operation_id),
    [first, second],
  );
  const duplicate = await post("/api/v1/call-leads/enrichment/sync", {
    items: [
      {
        operation_id: first,
        operation_kind: "lead_snapshot_apply",
        granot_statement: { source: "Synthetic Calls", priority: "1" },
      },
      {
        operation_id: first,
        operation_kind: "lead_snapshot_apply",
        granot_statement: { source: "Synthetic Calls", priority: "1" },
      },
    ],
  });
  assert.equal(duplicate.status, 400);
});

test("[AC-33] booked reconciliation permits only booking_action_apply", async () => {
  const rejected = await post("/api/v1/call-leads/booked-reconciliation/sync", {
    items: [
      {
        operation_id: operationId,
        operation_kind: "lead_snapshot_apply",
        granot_statement: { source: "Synthetic Calls", priority: "1" },
      },
    ],
  });
  assert.equal(rejected.status, 400);
  const accepted = await post("/api/v1/call-leads/booked-reconciliation/sync", {
    items: [
      {
        operation_id: operationId,
        operation_kind: "booking_action_apply",
        granot_statement: {
          source: "Synthetic Calls",
          event_type: "Booked",
          user: "MIKE",
          rep: "SALES",
        },
        expected_target: { model: "CallLead", id: formId },
      },
    ],
  });
  assert.equal(accepted.status, 200);
  assert.equal(applied[0]?.item.operation_kind, "booking_action_apply");
});
