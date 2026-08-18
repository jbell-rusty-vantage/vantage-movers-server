import assert from "node:assert/strict";
import test from "node:test";
import type { RingCentralProcessedCallDocument } from "./processed-calls-store";
import {
  ingestRingCentralQualifiedCall,
  type RingCentralIngestDependencies,
  type RingCentralQualifiedCall,
} from "./ringcentral-call-lead-ingest.service";

function call(
  ingestionSource: "webhook" | "call_log_sync" = "webhook",
): RingCentralQualifiedCall {
  return {
    ingestionSource,
    telephonySessionId: "u20-session",
    sessionId: "u20-session",
    partyId: ingestionSource === "webhook" ? "u20-party" : null,
    callLogId: ingestionSource === "call_log_sync" ? "u20-log" : null,
    sourceCompany: "main_site",
    sourceLabel: "Synthetic Calls",
    routeResolution: {
      route_id: "507f1f77bcf86cd799439001",
      assignment_id: "507f1f77bcf86cd799439002",
      normalized_target_number: "+15550000001",
      company_id: "507f1f77bcf86cd799439003",
      company_slug: "main_site",
      company_label_snapshot: "Synthetic Company",
      granularity_id: "507f1f77bcf86cd799439004",
      granularity_key: "synthetic_calls",
      granularity_label_snapshot: "Synthetic Calls",
      crm_label_snapshot: "Synthetic Calls",
    },
    callerPhoneNumber: "5550002001",
    callerName: "Synthetic Caller",
    targetPhoneNumber: "+15550000001",
    targetName: "Synthetic Queue",
    answeredAt: new Date("2026-08-18T16:00:01.000Z"),
    terminalAt: new Date("2026-08-18T16:03:01.000Z"),
    startTime: new Date("2026-08-18T16:00:00.000Z"),
    durationSeconds: 180,
    qualificationReason: "synthetic_qualified",
  };
}

const noEvent: RingCentralIngestDependencies["recordEvent"] = async () => null;

test("[AC-14] telephony replay returns before adoption candidate work", async () => {
  let convergenceCalls = 0;
  const stored: RingCentralProcessedCallDocument = {
    provider: "ringcentral",
    telephonySessionId: "u20-session",
    sessionId: "u20-session",
    callLogId: null,
    ingestionSource: "webhook",
    status: "lead_adopted",
    duplicate: false,
    duplicateReason: "unique",
    sourceCompany: "main_site",
    sourceLabel: "Synthetic Calls",
    callerPhoneNumber: "5550002001",
    durationSeconds: 180,
    qualificationReason: "synthetic_qualified",
    callLeadId: "507f1f77bcf86cd799439011",
    firstProcessedAt: new Date(),
    updatedAt: new Date(),
  };
  const result = await ingestRingCentralQualifiedCall(call(), new Date(), {
    findProcessedCall: async () => stored,
    attemptConvergence: async () => {
      convergenceCalls += 1;
      return { outcome: "not_found" };
    },
    recordEvent: noEvent,
  });
  assert.equal(result.action, "skipped_already_processed");
  assert.equal(result.callLeadId, stored.callLeadId);
  assert.equal(convergenceCalls, 0);
});

test("[AC-14][AC-15] adoption occurs before duplicate classification and suppresses create", async () => {
  const order: string[] = [];
  let createCalls = 0;
  const result = await ingestRingCentralQualifiedCall(call(), new Date(), {
    findProcessedCall: async () => null,
    adoptionEnabled: () => true,
    assertAdoptionIndexes: async () => undefined,
    resolveWriteMode: () => "create",
    attemptConvergence: async () => {
      order.push("adopt");
      return {
        outcome: "adopted",
        callLeadId: "507f1f77bcf86cd799439011",
        duplicate: false,
        duplicateReason: "unique",
      };
    },
    classifyDuplicate: async () => {
      order.push("duplicate");
      throw new Error("duplicate classification must be inside adoption");
    },
    createLead: async (input) => {
      createCalls += 1;
      throw new Error(`unexpected create for ${input.phone_number}`);
    },
    recordEvent: noEvent,
  });
  assert.equal(result.action, "lead_adopted");
  assert.deepEqual(order, ["adopt"]);
  assert.equal(createCalls, 0);
});

test("[AC-16] no adoption candidate continues through normal ingest", async () => {
  const order: string[] = [];
  let ledgerWrites = 0;
  const result = await ingestRingCentralQualifiedCall(call(), new Date(), {
    findProcessedCall: async () => null,
    adoptionEnabled: () => true,
    assertAdoptionIndexes: async () => undefined,
    resolveWriteMode: () => "dry_run",
    attemptConvergence: async ({ allowMutations }) => {
      assert.equal(allowMutations, false);
      order.push("adopt");
      return { outcome: "not_found" };
    },
    classifyDuplicate: async () => {
      order.push("duplicate");
      return {
        isDuplicate: false,
        reason: "unique",
        existingLeadId: null,
        windowDays: 90,
        matchCount: 0,
      };
    },
    upsertProcessedCall: async () => {
      order.push("ledger");
      ledgerWrites += 1;
    },
    recordEvent: noEvent,
  });
  assert.equal(result.action, "dry_run");
  assert.deepEqual(order, ["adopt", "duplicate", "ledger"]);
  assert.equal(ledgerWrites, 1);
});

test("[AC-14] webhook and Call Log descriptors enter equivalent convergence", async () => {
  const sources: string[] = [];
  for (const source of ["webhook", "call_log_sync"] as const) {
    const result = await ingestRingCentralQualifiedCall(
      call(source),
      new Date(),
      {
        findProcessedCall: async () => null,
        adoptionEnabled: () => true,
        assertAdoptionIndexes: async () => undefined,
        resolveWriteMode: () => "create",
        attemptConvergence: async ({ call: descriptor }) => {
          sources.push(descriptor.ingestionSource);
          return {
            outcome: "adopted",
            callLeadId: "507f1f77bcf86cd799439011",
            duplicate: true,
            duplicateReason: "same_source_phone_within_window",
          };
        },
        recordEvent: noEvent,
      },
    );
    assert.equal(result.action, "lead_adopted_duplicate");
  }
  assert.deepEqual(sources, ["webhook", "call_log_sync"]);
});

test("[AC-14] call-log-only create fails closed before candidate or Lead work without indexes", async () => {
  const descriptor = {
    ...call("call_log_sync"),
    telephonySessionId: null,
  };
  let convergenceCalls = 0;
  await assert.rejects(
    () =>
      ingestRingCentralQualifiedCall(descriptor, new Date(), {
        findProcessedCall: async () => null,
        adoptionEnabled: () => false,
        resolveWriteMode: () => "create",
        assertAdoptionIndexes: async () => {
          throw new Error("missing identity fence");
        },
        attemptConvergence: async () => {
          convergenceCalls += 1;
          return { outcome: "not_found" };
        },
        recordEvent: noEvent,
      }),
    /missing identity fence/,
  );
  assert.equal(convergenceCalls, 0);
});
