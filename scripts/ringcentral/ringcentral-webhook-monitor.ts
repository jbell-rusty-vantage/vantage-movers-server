import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../api/config/domain";
import { connectMongo } from "../../api/db";
import {
  CALL_CANDIDATE_DECISIONS_TEST_COLLECTION,
  CALL_CANDIDATES_TEST_COLLECTION,
} from "../../api/services/ringcentral/call-candidate-store";
import type {
  RingCentralCallCandidateDecisionDocument,
  RingCentralCallCandidateDocument,
  RingCentralWebhookEventDocument,
} from "../../api/services/ringcentral/call-candidate-types";
import {
  WEBHOOK_EVENTS_TEST_COLLECTION,
  type NormalizedPreview,
} from "../../api/services/ringcentral/webhook-capture";

type MonitorOptions = {
  limit: number;
  watch: boolean;
  intervalMs: number;
  json: boolean;
};

type StoredWebhookEvent = RingCentralWebhookEventDocument & {
  _id?: unknown;
  normalizedPreview?: NormalizedPreview;
};

type StoredCandidate = RingCentralCallCandidateDocument & {
  _id?: unknown;
};

type StoredDecision = RingCentralCallCandidateDecisionDocument & {
  _id?: unknown;
};

type MonitorSnapshot = {
  events: StoredWebhookEvent[];
  candidates: StoredCandidate[];
  decisions: StoredDecision[];
};

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  await connectMongo();

  const handleExit = async (): Promise<void> => {
    await mongoose.disconnect();
    process.exit(0);
  };
  process.once("SIGINT", () => {
    void handleExit();
  });
  process.once("SIGTERM", () => {
    void handleExit();
  });

  let watermarks = await printSnapshot(options, "snapshot");
  if (!options.watch) {
    await mongoose.disconnect();
    return;
  }

  console.log(
    `\nWatching RingCentral webhook test collections every ${options.intervalMs}ms. Press Ctrl+C to stop.`,
  );
  for (;;) {
    await delay(options.intervalMs);
    const next = await fetchSnapshotSince(options, watermarks);
    if (
      next.events.length === 0 &&
      next.candidates.length === 0 &&
      next.decisions.length === 0
    ) {
      continue;
    }
    watermarks = mergeWatermarks(watermarks, printSnapshotData(next, options, "update"));
  }
}

async function printSnapshot(
  options: MonitorOptions,
  label: string,
): Promise<Watermarks> {
  const snapshot = await fetchSnapshot(options);
  return printSnapshotData(snapshot, options, label);
}

type Watermarks = {
  eventReceivedAt: Date | null;
  candidateUpdatedAt: Date | null;
  decisionCreatedAt: Date | null;
};

function printSnapshotData(
  snapshot: MonitorSnapshot,
  options: MonitorOptions,
  label: string,
): Watermarks {
  if (options.json) {
    console.log(JSON.stringify({ label, ...snapshot }, null, 2));
  } else {
    console.log(`\n=== RingCentral webhook monitor: ${label} @ ${new Date().toISOString()} ===`);
    printWebhookEvents(snapshot.events);
    printCandidates(snapshot.candidates);
    printDecisions(snapshot.decisions);
  }

  return {
    eventReceivedAt: maxDate(snapshot.events.map((event) => event.receivedAt)),
    candidateUpdatedAt: maxDate(
      snapshot.candidates.map((candidate) => candidate.updatedAt),
    ),
    decisionCreatedAt: maxDate(
      snapshot.decisions.map((decision) => decision.createdAt),
    ),
  };
}

async function fetchSnapshot(options: MonitorOptions): Promise<MonitorSnapshot> {
  const db = getDb();
  const [events, candidates, decisions] = await Promise.all([
    db
      .collection<StoredWebhookEvent>(WEBHOOK_EVENTS_TEST_COLLECTION)
      .find({}, { projection: { rawBody: 0, headers: 0 } })
      .sort({ receivedAt: -1 })
      .limit(options.limit)
      .toArray(),
    db
      .collection<StoredCandidate>(CALL_CANDIDATES_TEST_COLLECTION)
      .find({}, { projection: { rawLatestParty: 0 } })
      .sort({ updatedAt: -1 })
      .limit(options.limit)
      .toArray(),
    db
      .collection<StoredDecision>(CALL_CANDIDATE_DECISIONS_TEST_COLLECTION)
      .find({})
      .sort({ createdAt: -1 })
      .limit(options.limit)
      .toArray(),
  ]);

  return {
    events: events.reverse(),
    candidates: candidates.reverse(),
    decisions: decisions.reverse(),
  };
}

async function fetchSnapshotSince(
  options: MonitorOptions,
  watermarks: Watermarks,
): Promise<MonitorSnapshot> {
  const db = getDb();
  const [events, candidates, decisions] = await Promise.all([
    db
      .collection<StoredWebhookEvent>(WEBHOOK_EVENTS_TEST_COLLECTION)
      .find(
        watermarks.eventReceivedAt
          ? { receivedAt: { $gt: watermarks.eventReceivedAt } }
          : {},
        { projection: { rawBody: 0, headers: 0 } },
      )
      .sort({ receivedAt: 1 })
      .limit(options.limit)
      .toArray(),
    db
      .collection<StoredCandidate>(CALL_CANDIDATES_TEST_COLLECTION)
      .find(
        watermarks.candidateUpdatedAt
          ? { updatedAt: { $gt: watermarks.candidateUpdatedAt } }
          : {},
        { projection: { rawLatestParty: 0 } },
      )
      .sort({ updatedAt: 1 })
      .limit(options.limit)
      .toArray(),
    db
      .collection<StoredDecision>(CALL_CANDIDATE_DECISIONS_TEST_COLLECTION)
      .find(
        watermarks.decisionCreatedAt
          ? { createdAt: { $gt: watermarks.decisionCreatedAt } }
          : {},
      )
      .sort({ createdAt: 1 })
      .limit(options.limit)
      .toArray(),
  ]);

  return { events, candidates, decisions };
}

function printWebhookEvents(events: StoredWebhookEvent[]): void {
  console.log(`\nRaw webhook events (${events.length})`);
  if (events.length === 0) {
    console.log("  none");
    return;
  }

  for (const event of events) {
    const preview = event.normalizedPreview;
    console.log(
      [
        `  ${formatDate(event.receivedAt)}`,
        `uuid=${event.uuid ?? "missing"}`,
        `seq=${event.sequence ?? "?"}`,
        `session=${event.telephonySessionId ?? preview?.telephonySessionId ?? "?"}`,
        `party=${preview?.partyId ?? "?"}`,
        `dir=${preview?.direction ?? "?"}`,
        `status=${preview?.statusCode ?? "?"}`,
        `from=${preview?.fromPhoneNumber ?? "?"}`,
        `to=${preview?.toPhoneNumber ?? "?"}`,
      ].join(" | "),
    );
  }
}

function printCandidates(candidates: StoredCandidate[]): void {
  console.log(`\nCall candidates (${candidates.length})`);
  if (candidates.length === 0) {
    console.log("  none");
    return;
  }

  for (const candidate of candidates) {
    console.log(
      [
        `  ${formatDate(candidate.updatedAt)}`,
        `session=${candidate.telephonySessionId}`,
        `party=${candidate.partyId}`,
        `dir=${candidate.direction ?? "?"}`,
        `status=${candidate.statusCode ?? "?"}`,
        `decision=${candidate.decisionStatus}`,
        `reason=${candidate.decisionReason ?? "?"}`,
        `answered=${candidate.answered ? "yes" : "no"}`,
        `duration=${candidate.estimatedDurationSeconds ?? 0}s`,
        `source=${candidate.sourceLabel ?? "unmatched"}`,
        `caller=${candidate.normalizedFromPhoneNumber ?? candidate.fromPhoneNumber ?? "?"}`,
        `target=${candidate.normalizedToPhoneNumber ?? candidate.toPhoneNumber ?? "?"}`,
      ].join(" | "),
    );
  }
}

function printDecisions(decisions: StoredDecision[]): void {
  console.log(`\nDecision snapshots (${decisions.length})`);
  if (decisions.length === 0) {
    console.log("  none");
    return;
  }

  for (const decision of decisions) {
    console.log(
      [
        `  ${formatDate(decision.createdAt)}`,
        `session=${decision.telephonySessionId}`,
        `party=${decision.partyId}`,
        `decision=${decision.decisionStatus}`,
        `wouldCreate=${decision.wouldCreateCallLead ? "yes" : "no"}`,
        `reason=${decision.decisionReason}`,
        decision.leadPreview
          ? `leadPreview=${decision.leadPreview.sourceCompany}/${decision.leadPreview.callerPhoneNumber}`
          : "leadPreview=none",
      ].join(" | "),
    );
  }
}

function parseOptions(args: string[]): MonitorOptions {
  const options: MonitorOptions = {
    limit: 20,
    watch: false,
    intervalMs: 2_000,
    json: false,
  };

  for (const arg of args) {
    if (arg === "--watch" || arg === "-w") {
      options.watch = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg.startsWith("--limit=")) {
      options.limit = parsePositiveInteger(arg.slice("--limit=".length), options.limit);
    } else if (arg.startsWith("--interval-ms=")) {
      options.intervalMs = parsePositiveInteger(
        arg.slice("--interval-ms=".length),
        options.intervalMs,
      );
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`RingCentral webhook monitor

Usage:
  pnpm run ringcentral:webhook:monitor
  pnpm run ringcentral:webhook:monitor -- --limit=50
  pnpm run ringcentral:webhook:monitor -- --watch --interval-ms=2000
  pnpm run ringcentral:webhook:monitor -- --json
`);
}

function getDb() {
  const db = mongoose.connection.useDb(getMongoDatabaseName(), {
    useCache: true,
  }).db;
  if (!db) {
    throw new Error("MongoDB connection is not ready");
  }
  return db;
}

function maxDate(values: Array<Date | null | undefined>): Date | null {
  let max: Date | null = null;
  for (const value of values) {
    if (!value) {
      continue;
    }
    if (!max || value.getTime() > max.getTime()) {
      max = value;
    }
  }
  return max;
}

function mergeWatermarks(current: Watermarks, next: Watermarks): Watermarks {
  return {
    eventReceivedAt: laterDate(current.eventReceivedAt, next.eventReceivedAt),
    candidateUpdatedAt: laterDate(current.candidateUpdatedAt, next.candidateUpdatedAt),
    decisionCreatedAt: laterDate(current.decisionCreatedAt, next.decisionCreatedAt),
  };
}

function laterDate(left: Date | null, right: Date | null): Date | null {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return left.getTime() > right.getTime() ? left : right;
}

function parsePositiveInteger(value: string, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function formatDate(value: Date | string | null | undefined): string {
  if (!value) {
    return "?";
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "?" : date.toISOString();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch(async (error) => {
  console.error(
    `RingCentral webhook monitor failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  await mongoose.disconnect();
  process.exitCode = 1;
});
