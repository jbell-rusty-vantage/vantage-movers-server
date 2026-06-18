import { promises as fs } from "node:fs";
import { CALL_LEAD_MINIMUM_ANSWERED_SECONDS } from "../../api/services/ringcentral/call-candidate-evaluator";
import { buildRingCentralCandidateDocument } from "../../api/services/ringcentral/call-candidate-store";
import type { RingCentralCallCandidateDocument } from "../../api/services/ringcentral/call-candidate-types";
import { aggregateRingCentralCallSession } from "../../api/services/ringcentral/call-session-aggregator";
import { vetRingCentralCallLogRecord } from "../../api/services/ringcentral/call-log-vetting";
import {
  getRingCentralRuntimeConfig,
  resolveRingCentralLeadWriteMode,
} from "../../api/services/ringcentral/ringcentral-config";
import { classifyRingCentralCallLeadDuplicate } from "../../api/services/ringcentral/ringcentral-duplicate-guard";
import { normalizeRingCentralWebhookPayload } from "../../api/services/ringcentral/webhook-event-normalizer";

/**
 * Offline, deterministic end-to-end proof for BOTH RingCentral lead
 * strategies. It runs the real pure pipeline (normalizer -> per-party
 * candidates -> session aggregator -> evaluator for webhooks; shared vetting
 * for the cron Call Log path; the duplicate guard for both) against crafted
 * fixtures and asserts the expected decision for each scenario.
 *
 * It needs no database, RingCentral credentials, or ngrok, so it always runs
 * and produces two reviewable artifacts:
 *   - ringcentral-workflow-test-output.json  (structured pass/fail proof)
 *   - ringcentral-workflow-test.log          (human-readable timeline)
 *
 * Live, DB-backed verification is done separately with
 * `pnpm ringcentral:webhook:monitor` and `pnpm ringcentral:call-log:sync:run`.
 */
const JSON_ARTIFACT = "ringcentral-workflow-test-output.json";
const LOG_ARTIFACT = "ringcentral-workflow-test.log";

const QUALIFIED_TOLL_FREE = "+18883164387"; // 10BEST LANDING -> tbm_leads
const TBM_TOLL_FREE = "+18883083612"; // TBM Prime -> tbm_prime_leads
const UNMAPPED_NUMBER = "+19998887777";
const CALLER_A = "+12095551234";
const CALLER_B = "+13055559876";

const T0 = new Date("2026-06-03T18:00:00.000Z");
const logLines: string[] = [];

type Check = {
  scenario: string;
  field: string;
  expected: unknown;
  actual: unknown;
  pass: boolean;
};

const checks: Check[] = [];

function log(line: string): void {
  logLines.push(line);
  console.log(line);
}

function expect(scenario: string, field: string, expected: unknown, actual: unknown): void {
  const pass = JSON.stringify(expected) === JSON.stringify(actual);
  checks.push({ scenario, field, expected, actual, pass });
  log(
    `  [${pass ? "PASS" : "FAIL"}] ${field}: expected=${JSON.stringify(
      expected,
    )} actual=${JSON.stringify(actual)}`,
  );
}

function inboundWebhookPayload(params: {
  uuid: string;
  sequence: number;
  telephonySessionId: string;
  sessionId: string;
  partyId: string;
  direction?: string;
  statusCode: string;
  eventTime: Date;
  toPhoneNumber: string;
  fromPhoneNumber: string;
  queueCall?: boolean;
  missedCall?: boolean;
}): unknown {
  return {
    uuid: params.uuid,
    event:
      "/restapi/v1.0/account/62948571023/extension/584528022/telephony/sessions",
    timestamp: params.eventTime.toISOString(),
    subscriptionId: "test-subscription",
    ownerId: "62948571023",
    body: {
      sequence: params.sequence,
      sessionId: params.sessionId,
      telephonySessionId: params.telephonySessionId,
      eventTime: params.eventTime.toISOString(),
      parties: [
        {
          accountId: "62948571023",
          extensionId: "584528022",
          id: params.partyId,
          direction: params.direction ?? "Inbound",
          to: { phoneNumber: params.toPhoneNumber, name: "10BEST LANDING" },
          from: { phoneNumber: params.fromPhoneNumber, name: "Caller" },
          status: { code: params.statusCode },
          queueCall: params.queueCall ?? true,
          missedCall: params.missedCall ?? false,
        },
      ],
    },
  };
}

function foldWebhookSession(
  payloads: unknown[],
  now: Date,
): RingCentralCallCandidateDocument[] {
  const byParty = new Map<string, RingCentralCallCandidateDocument>();
  for (const payload of payloads) {
    const events = normalizeRingCentralWebhookPayload(payload, now);
    for (const event of events) {
      const existing = byParty.get(event.partyId) ?? null;
      byParty.set(
        event.partyId,
        buildRingCentralCandidateDocument(existing, event, now),
      );
    }
  }
  return [...byParty.values()];
}

function runWebhookScenarios(): void {
  log("\n=== WEBHOOK WORKFLOW (telephony session -> session aggregate) ===");

  // S1: qualified — inbound to mapped toll-free, answered, terminal after 121s.
  log("\n[S1] Inbound to +18883164387, answered, disconnected after 121s");
  {
    const answeredAt = T0;
    const terminalAt = new Date(T0.getTime() + 121_000);
    const parties = foldWebhookSession(
      [
        inboundWebhookPayload({
          uuid: "s1-1",
          sequence: 1,
          telephonySessionId: "s1",
          sessionId: "sess-1",
          partyId: "p-s1-q",
          statusCode: "Proceeding",
          eventTime: answeredAt,
          toPhoneNumber: QUALIFIED_TOLL_FREE,
          fromPhoneNumber: CALLER_A,
        }),
        inboundWebhookPayload({
          uuid: "s1-2",
          sequence: 2,
          telephonySessionId: "s1",
          sessionId: "sess-1",
          partyId: "p-s1-q",
          statusCode: "Answered",
          eventTime: answeredAt,
          toPhoneNumber: QUALIFIED_TOLL_FREE,
          fromPhoneNumber: CALLER_A,
        }),
        inboundWebhookPayload({
          uuid: "s1-3",
          sequence: 3,
          telephonySessionId: "s1",
          sessionId: "sess-1",
          partyId: "p-s1-q",
          statusCode: "Disconnected",
          eventTime: terminalAt,
          toPhoneNumber: QUALIFIED_TOLL_FREE,
          fromPhoneNumber: CALLER_A,
        }),
      ],
      new Date(terminalAt.getTime() + 1_000),
    );
    const { document } = aggregateRingCentralCallSession(
      parties,
      new Date(terminalAt.getTime() + 1_000),
    );
    expect("S1", "decisionStatus", "qualified", document.decisionStatus);
    expect("S1", "wouldCreateCallLead", true, document.wouldCreateCallLead);
    expect("S1", "ingestEligible", true, document.ingestEligible);
    expect("S1", "estimatedDurationSeconds", 121, document.estimatedDurationSeconds);
    expect("S1", "sourceCompany", "tbm_leads", document.sourceCompany);
  }

  // S2: under 120s — answered then disconnected after 30s.
  log("\n[S2] Inbound answered, disconnected after 30s (under 120)");
  {
    const terminalAt = new Date(T0.getTime() + 30_000);
    const parties = foldWebhookSession(
      [
        inboundWebhookPayload({
          uuid: "s2-1",
          sequence: 1,
          telephonySessionId: "s2",
          sessionId: "sess-2",
          partyId: "p-s2-q",
          statusCode: "Answered",
          eventTime: T0,
          toPhoneNumber: QUALIFIED_TOLL_FREE,
          fromPhoneNumber: CALLER_B,
        }),
        inboundWebhookPayload({
          uuid: "s2-2",
          sequence: 2,
          telephonySessionId: "s2",
          sessionId: "sess-2",
          partyId: "p-s2-q",
          statusCode: "Disconnected",
          eventTime: terminalAt,
          toPhoneNumber: QUALIFIED_TOLL_FREE,
          fromPhoneNumber: CALLER_B,
        }),
      ],
      new Date(terminalAt.getTime() + 1_000),
    );
    const { document } = aggregateRingCentralCallSession(parties);
    expect("S2", "decisionStatus", "rejected", document.decisionStatus);
    expect("S2", "decisionReason", "under_120_seconds", document.decisionReason);
    expect("S2", "ingestEligible", false, document.ingestEligible);
  }

  // S3: outbound — should never be a lead.
  log("\n[S3] Outbound call");
  {
    const parties = foldWebhookSession(
      [
        inboundWebhookPayload({
          uuid: "s3-1",
          sequence: 1,
          telephonySessionId: "s3",
          sessionId: "sess-3",
          partyId: "p-s3",
          direction: "Outbound",
          statusCode: "Answered",
          eventTime: T0,
          toPhoneNumber: UNMAPPED_NUMBER,
          fromPhoneNumber: QUALIFIED_TOLL_FREE,
          queueCall: false,
        }),
      ],
      T0,
    );
    const { document } = aggregateRingCentralCallSession(parties);
    expect("S3", "decisionStatus", "rejected", document.decisionStatus);
    expect("S3", "decisionReason", "not_inbound", document.decisionReason);
  }

  // S4: wrong toll-free — inbound answered >120s but to an unmapped number.
  log("\n[S4] Inbound answered >120s to an unmapped number");
  {
    const terminalAt = new Date(T0.getTime() + 200_000);
    const parties = foldWebhookSession(
      [
        inboundWebhookPayload({
          uuid: "s4-1",
          sequence: 1,
          telephonySessionId: "s4",
          sessionId: "sess-4",
          partyId: "p-s4",
          statusCode: "Answered",
          eventTime: T0,
          toPhoneNumber: UNMAPPED_NUMBER,
          fromPhoneNumber: CALLER_A,
        }),
        inboundWebhookPayload({
          uuid: "s4-2",
          sequence: 2,
          telephonySessionId: "s4",
          sessionId: "sess-4",
          partyId: "p-s4",
          statusCode: "Disconnected",
          eventTime: terminalAt,
          toPhoneNumber: UNMAPPED_NUMBER,
          fromPhoneNumber: CALLER_A,
        }),
      ],
      new Date(terminalAt.getTime() + 1_000),
    );
    const { document } = aggregateRingCentralCallSession(parties);
    expect("S4", "decisionStatus", "rejected", document.decisionStatus);
    expect(
      "S4",
      "decisionReason",
      "target_number_not_matched",
      document.decisionReason,
    );
  }

  // S5: still in progress — qualified by elapsed time but NOT yet ingestable.
  log("\n[S5] Inbound answered, still live, elapsed > 120s (no terminal yet)");
  {
    const now = new Date(T0.getTime() + 121_000);
    const parties = foldWebhookSession(
      [
        inboundWebhookPayload({
          uuid: "s5-1",
          sequence: 1,
          telephonySessionId: "s5",
          sessionId: "sess-5",
          partyId: "p-s5",
          statusCode: "Answered",
          eventTime: T0,
          toPhoneNumber: QUALIFIED_TOLL_FREE,
          fromPhoneNumber: CALLER_A,
        }),
      ],
      now,
    );
    const { document } = aggregateRingCentralCallSession(parties, now);
    expect("S5", "wouldCreateCallLead", true, document.wouldCreateCallLead);
    expect("S5", "terminal", false, document.terminal);
    expect("S5", "ingestEligible", false, document.ingestEligible);
  }
}

async function runDuplicateScenarios(): Promise<void> {
  log("\n=== DUPLICATE GUARD (same caller + source within window) ===");

  // First successful call from CALLER_A to tbm_leads (10best line): unique.
  log("\n[D1] First successful call from caller -> unique");
  {
    const result = await classifyRingCentralCallLeadDuplicate(
      {
        sourceCompany: "tbm_leads",
        callerPhoneNumber: CALLER_A,
        telephonySessionId: "dup-session-1",
        callTimestamp: T0,
      },
      { findRecentCallLeads: async () => [] },
    );
    expect("D1", "isDuplicate", false, result.isDuplicate);
    expect("D1", "reason", "unique", result.reason);
  }

  // Second successful call from same caller + source within window: duplicate.
  log("\n[D2] Second call same caller + source within window -> duplicate");
  {
    const result = await classifyRingCentralCallLeadDuplicate(
      {
        sourceCompany: "tbm_leads",
        callerPhoneNumber: CALLER_A,
        telephonySessionId: "dup-session-2",
        callTimestamp: new Date(T0.getTime() + 2 * 60 * 60 * 1000),
      },
      {
        findRecentCallLeads: async () => [
          {
            _id: { toString: () => "existing-lead-1" },
            phone_number: CALLER_A,
            ringcentral: { telephony_session_id: "dup-session-1" },
          },
        ],
      },
    );
    expect("D2", "isDuplicate", true, result.isDuplicate);
    expect("D2", "reason", "same_source_phone_within_window", result.reason);
    expect("D2", "existingLeadId", "existing-lead-1", result.existingLeadId);
  }
}

function runCronScenarios(): void {
  log("\n=== CRON WORKFLOW (Call Log record -> shared vetting) ===");

  // C1: qualified call-log record.
  log("\n[C1] Inbound Completed 180s to +18883083612 (TBM Prime)");
  {
    const vet = vetRingCentralCallLogRecord({
      id: "cl-1",
      sessionId: "sess-c1",
      telephonySessionId: "tcl-1",
      startTime: T0.toISOString(),
      direction: "Inbound",
      type: "Voice",
      result: "Completed",
      duration: 180,
      to: { phoneNumber: TBM_TOLL_FREE, name: "TBM Prime Inbounds" },
      from: { phoneNumber: "+13055551111", name: "Caller" },
    });
    expect("C1", "qualifies", true, vet.qualifies);
    expect("C1", "sourceCompany", "tbm_prime_leads", vet.sourceCompany);
    expect("C1", "durationSeconds", 180, vet.durationSeconds);
  }

  // C2: under 120s.
  log("\n[C2] Inbound Completed 45s -> under 120");
  {
    const vet = vetRingCentralCallLogRecord({
      id: "cl-2",
      direction: "Inbound",
      result: "Completed",
      duration: 45,
      to: { phoneNumber: TBM_TOLL_FREE },
      from: { phoneNumber: "+13055552222" },
    });
    expect("C2", "qualifies", false, vet.qualifies);
    expect("C2", "rejectionReasons.includesUnder120", true, vet.rejectionReasons.includes("under_120_seconds"));
  }

  // C3: outbound.
  log("\n[C3] Outbound -> not a lead");
  {
    const vet = vetRingCentralCallLogRecord({
      id: "cl-3",
      direction: "Outbound",
      result: "Completed",
      duration: 300,
      to: { phoneNumber: UNMAPPED_NUMBER },
      from: { phoneNumber: TBM_TOLL_FREE },
    });
    expect("C3", "qualifies", false, vet.qualifies);
    expect("C3", "rejectionReasons.includesNotInbound", true, vet.rejectionReasons.includes("not_inbound"));
  }

  // C4: not answered.
  log("\n[C4] Inbound Missed -> not answered");
  {
    const vet = vetRingCentralCallLogRecord({
      id: "cl-4",
      direction: "Inbound",
      result: "Missed",
      duration: 0,
      to: { phoneNumber: TBM_TOLL_FREE },
      from: { phoneNumber: "+13055553333" },
    });
    expect("C4", "qualifies", false, vet.qualifies);
    expect("C4", "rejectionReasons.includesNotAnswered", true, vet.rejectionReasons.includes("not_answered"));
  }

  log(
    "\n[Cross-path] Idempotency key = telephonySessionId is shared by both paths; " +
      "a webhook-created session (e.g. 's1') re-seen in Call Log is skipped via ringcentral_processed_calls.",
  );
}

async function main(): Promise<void> {
  const config = getRingCentralRuntimeConfig();
  const writeMode = resolveRingCentralLeadWriteMode();

  log("RingCentral hybrid workflow test (offline, deterministic)");
  log(`Generated: ${new Date().toISOString()}`);
  log(`Minimum answered duration: ${CALL_LEAD_MINIMUM_ANSWERED_SECONDS}s`);
  log(`Resolved hybrid mode: ${config.hybridMode}`);
  log(`Resolved lead write mode: ${writeMode}`);
  log(
    `Flags: webhookEnabled=${config.webhookEnabled} callLogSyncEnabled=${config.callLogSyncEnabled} ` +
      `createCallLeads=${config.createCallLeads} shadowCallLeads=${config.shadowCallLeads} ` +
      `collectionMode=${config.collectionMode} duplicateWindowHours=${config.duplicateWindowHours}`,
  );

  runWebhookScenarios();
  await runDuplicateScenarios();
  runCronScenarios();

  const failed = checks.filter((check) => !check.pass);
  const summary = {
    generatedAt: new Date().toISOString(),
    config,
    writeMode,
    totalChecks: checks.length,
    passed: checks.length - failed.length,
    failed: failed.length,
    allPassed: failed.length === 0,
    checks,
  };

  log(`\n=== SUMMARY: ${summary.passed}/${summary.totalChecks} checks passed ===`);
  if (failed.length > 0) {
    log("FAILURES:");
    for (const check of failed) {
      log(`  ${check.scenario} ${check.field}`);
    }
  }

  await fs.writeFile(JSON_ARTIFACT, `${JSON.stringify(summary, null, 2)}\n`);
  await fs.writeFile(LOG_ARTIFACT, `${logLines.join("\n")}\n`);
  log(`\nWrote ${JSON_ARTIFACT} and ${LOG_ARTIFACT}`);

  if (!summary.allPassed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
