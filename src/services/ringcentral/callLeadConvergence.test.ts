import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import {
  selectRingCentralConvergenceCandidates,
  type RingCentralConvergenceCandidateQuery,
  type RingCentralConvergenceDependencies,
} from "./callLeadConvergence.service";
import type { RingCentralQualifiedCall } from "./ringcentral-call-lead-ingest.service";

const START = new Date("2026-08-18T16:00:00.000Z");
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

function qualifiedCall(
  overrides: Partial<RingCentralQualifiedCall> = {},
): RingCentralQualifiedCall {
  return {
    ingestionSource: "webhook",
    telephonySessionId: "u20-session-1",
    sessionId: "u20-session-1",
    partyId: "u20-party-1",
    callLogId: null,
    sourceCompany: "main_site",
    sourceLabel: "Synthetic Call",
    routeResolution: {
      route_id: "507f1f77bcf86cd799439001",
      assignment_id: "507f1f77bcf86cd799439002",
      normalized_target_number: "+15550000001",
      company_id: "507f1f77bcf86cd799439003",
      company_slug: "main_site",
      company_label_snapshot: "Synthetic Company",
      granularity_id: "507f1f77bcf86cd799439004",
      granularity_key: "synthetic_call",
      granularity_label_snapshot: "Synthetic Calls",
      crm_label_snapshot: "Synthetic Calls",
    },
    callerPhoneNumber: "5550002001",
    callerName: "Synthetic Caller",
    targetPhoneNumber: "+15550000001",
    targetName: "Synthetic Queue",
    answeredAt: new Date(START.getTime() + 1_000),
    terminalAt: new Date(START.getTime() + 181_000),
    startTime: START,
    durationSeconds: 180,
    qualificationReason: "synthetic_qualified",
    ...overrides,
  };
}

function deps(
  rows: Array<{
    id: string;
    revision?: number;
    immutablePhone?: string;
  }>,
  capture?: RingCentralConvergenceCandidateQuery[],
): RingCentralConvergenceDependencies {
  return {
    findCandidates: async (query) => {
      capture?.push(query);
      return rows.map((row) => ({
        _id: new mongoose.Types.ObjectId(row.id),
        domain_revision: row.revision ?? 0,
        ingested_contact_snapshot: {
          normalized_phone_number:
            row.immutablePhone ?? "5550002001",
        },
      }));
    },
  };
}

test("[AC-14] one exact immutable-phone candidate is selected without guessing", async () => {
  const result = await selectRingCentralConvergenceCandidates(
    qualifiedCall(),
    undefined,
    deps([
      {
        id: "507f1f77bcf86cd799439011",
        revision: 3,
      },
    ]),
  );
  assert.deepEqual(result, {
    outcome: "candidate",
    candidate: {
      call_lead_id: "507f1f77bcf86cd799439011",
      domain_revision: 3,
    },
  });
});

test("[AC-16] zero and multiple candidates remain explicit outcomes", async () => {
  const none = await selectRingCentralConvergenceCandidates(
    qualifiedCall(),
    undefined,
    deps([]),
  );
  assert.deepEqual(none, { outcome: "not_found", candidates: [] });

  const multiple = await selectRingCentralConvergenceCandidates(
    qualifiedCall(),
    undefined,
    deps([
      { id: "507f1f77bcf86cd799439011" },
      { id: "507f1f77bcf86cd799439012" },
    ]),
  );
  assert.equal(multiple.outcome, "conflict");
  if (multiple.outcome === "conflict") {
    assert.equal(multiple.candidates.length, 2);
  }
});

test("[AC-14][AC-16] candidate window is inclusive at exactly plus/minus 12 hours", async () => {
  const captured: RingCentralConvergenceCandidateQuery[] = [];
  await selectRingCentralConvergenceCandidates(
    qualifiedCall(),
    undefined,
    deps([], captured),
  );
  assert.equal(captured.length, 1);
  assert.equal(
    captured[0]!.created_from.toISOString(),
    new Date(START.getTime() - TWELVE_HOURS_MS).toISOString(),
  );
  assert.equal(
    captured[0]!.created_to.toISOString(),
    new Date(START.getTime() + TWELVE_HOURS_MS).toISOString(),
  );
  assert.equal(
    captured[0]!.source_granularity_id,
    "507f1f77bcf86cd799439004",
  );
  assert.equal(captured[0]!.normalized_phone_number, "5550002001");
});

test("[AC-14][AC-16] exact boundaries qualify and one millisecond outside does not", async () => {
  const candidateId = new mongoose.Types.ObjectId(
    "507f1f77bcf86cd799439011",
  );
  for (const createdAt of [
    new Date(START.getTime() - TWELVE_HOURS_MS),
    new Date(START.getTime() + TWELVE_HOURS_MS),
  ]) {
    const result = await selectRingCentralConvergenceCandidates(
      qualifiedCall(),
      undefined,
      {
        findCandidates: async ({ created_from, created_to }) =>
          createdAt >= created_from && createdAt <= created_to
            ? [
                {
                  _id: candidateId,
                  domain_revision: 0,
                  ingested_contact_snapshot: {
                    normalized_phone_number: "5550002001",
                  },
                },
              ]
            : [],
      },
    );
    assert.equal(result.outcome, "candidate");
  }
  for (const createdAt of [
    new Date(START.getTime() - TWELVE_HOURS_MS - 1),
    new Date(START.getTime() + TWELVE_HOURS_MS + 1),
  ]) {
    const result = await selectRingCentralConvergenceCandidates(
      qualifiedCall(),
      undefined,
      {
        findCandidates: async ({ created_from, created_to }) =>
          createdAt >= created_from && createdAt <= created_to
            ? [
                {
                  _id: candidateId,
                  domain_revision: 0,
                  ingested_contact_snapshot: {
                    normalized_phone_number: "5550002001",
                  },
                },
              ]
            : [],
      },
    );
    assert.equal(result.outcome, "not_found");
  }
});

test("[AC-16] missing call start fails adoption closed without querying candidates", async () => {
  let queried = false;
  const result = await selectRingCentralConvergenceCandidates(
    qualifiedCall({ startTime: null }),
    undefined,
    {
      findCandidates: async () => {
        queried = true;
        return [];
      },
    },
  );
  assert.deepEqual(result, {
    outcome: "ineligible",
    reason: "missing_start_time",
  });
  assert.equal(queried, false);
});

test("[AC-16] Job-only/missing-phone input is never an adoption candidate", async () => {
  const result = await selectRingCentralConvergenceCandidates(
    qualifiedCall({ callerPhoneNumber: "" }),
    undefined,
    deps([]),
  );
  assert.deepEqual(result, {
    outcome: "ineligible",
    reason: "missing_caller_phone",
  });
});

test("adoption match key stays exact Source Granularity plus ingested phone", () => {
  const source = readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "callLeadConvergence.service.ts",
    ),
    "utf8",
  );
  assert.match(
    source,
    /source_granularity_id: query\.source_granularity_id/,
  );
  assert.match(
    source,
    /ingestion_origin: "granot_lead_created"/,
  );
  assert.match(
    source,
    /"ringcentral_convergence\.state": "pending"/,
  );
  assert.match(
    source,
    /"ingested_contact_snapshot\.normalized_phone_number":\s+query\.normalized_phone_number/,
  );
  assert.equal(source.includes("lead_source_company: query"), false);
  assert.match(
    source,
    /source_granularity_id: input\.source_granularity_id/,
  );
});

test("[AC-16] different Source Granularity with the same phone is not an adoption candidate", async () => {
  const otherGranularity = "507f1f77bcf86cd799439099";
  const result = await selectRingCentralConvergenceCandidates(
    qualifiedCall(),
    undefined,
    {
      findCandidates: async (query) => {
        assert.equal(query.source_granularity_id, "507f1f77bcf86cd799439004");
        assert.notEqual(query.source_granularity_id, otherGranularity);
        return [];
      },
    },
  );
  assert.deepEqual(result, { outcome: "not_found", candidates: [] });
});

test("[AC-14] current-contact drift cannot replace immutable creation phone", async () => {
  const result = await selectRingCentralConvergenceCandidates(
    qualifiedCall(),
    undefined,
    deps([
      {
        id: "507f1f77bcf86cd799439011",
        immutablePhone: "5550002999",
      },
    ]),
  );
  assert.deepEqual(result, { outcome: "not_found", candidates: [] });
});
