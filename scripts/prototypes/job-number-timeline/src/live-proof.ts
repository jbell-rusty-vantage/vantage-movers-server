/**
 * Read-only JTE-05 proof helpers. No writes. Job Numbers stay aliased in
 * committed reports; this module never invents events or codes.
 */
import type { EnhancedJobTimelinePage, JobTimelinePage } from "../../../../src/services/jobNumberTimeline/types.js";
import { assertPageSafe, pageContainsForbiddenContact } from "../../../../src/services/jobNumberTimeline/masking.js";

function isEnhancedJobTimelinePage(
  page: JobTimelinePage,
): page is EnhancedJobTimelinePage {
  return "schema_version" in page && page.schema_version === "job_timeline.v2";
}

export const JOB_TIMELINE_PROOF_COLLECTIONS = [
  "lead_source_granularities",
  "granot_observations",
  "granot_record_links",
  "booked_leads",
  "granot_booking_reconciliation_cases",
  "granot_release_reconciliation_cases",
  "granot_booking_discrepancies",
  "granot_release_discrepancies",
  "synchronization_decisions",
  "granot_webhook_receipts",
  "cancelled_leads",
  "form_leads",
  "call_leads",
  "entity_changes",
  "lead_messages",
  "sheet_sync_jobs",
  "granot_crm_sources",
] as const;

export type CountableDb = {
  collection(name: string): { countDocuments(filter: Record<string, never>): Promise<number> };
};

export function proofCollectionNames(ringcentral: {
  callLogSyncState: string;
  processedCalls: string;
}): string[] {
  return [
    ...JOB_TIMELINE_PROOF_COLLECTIONS,
    ringcentral.callLogSyncState,
    ringcentral.processedCalls,
  ];
}

export async function countProofCollections(
  db: CountableDb,
  names: readonly string[],
): Promise<Record<string, number>> {
  const pairs = await Promise.all(names.map(async (name) => [
    name,
    await db.collection(name).countDocuments({}),
  ] as const));
  return Object.fromEntries(pairs);
}

export function collectionCountDeltas(
  before: Record<string, number>,
  after: Record<string, number>,
): Record<string, number> {
  const deltas: Record<string, number> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const delta = (after[key] ?? 0) - (before[key] ?? 0);
    if (delta !== 0) deltas[key] = delta;
  }
  return deltas;
}

export function aliasJobNumber(value: string, aliases: Map<string, string>): string {
  const existing = aliases.get(value);
  if (existing) return existing;
  const next = `JOB-${aliases.size + 1}`;
  aliases.set(value, next);
  return next;
}

export type PageProofNotes = {
  alias: string;
  proof_shape: string;
  outcome: string | null;
  event_count: number;
  activity_member_count: number;
  activity_grouping_preserves_counts: boolean;
  kinds: string[];
  attention_codes: string[];
  has_pre_job_walkback: boolean;
  has_booking_intake: boolean;
  has_official_booking: boolean;
  has_cancellation_intake: boolean;
  has_official_cancellation: boolean;
  forbidden_scan: "pass" | "fail";
};

function eventKinds(page: JobTimelinePage): string[] {
  return [...new Set(page.events.map((event) => event.kind))];
}

function hasPreJobWalkback(page: JobTimelinePage): boolean {
  if (page.coverage.job_number_at_create) return false;
  return (
    page.events.some((event) => event.kind === "lead_created")
    && page.events.some((event) => event.kind === "job_number_acquired")
  );
}

export function activityGroupingPreservesCounts(page: JobTimelinePage): boolean {
  const eventIds = new Set(page.events.map((event) => event.id));
  if (eventIds.size !== page.events.length) return false;
  if (!isEnhancedJobTimelinePage(page)) return true;
  if (page.summary.event_count !== page.events.length) return false;
  const members = page.activities.flatMap((activity) => activity.event_ids);
  return members.every((id) => eventIds.has(id));
}

export function scanSerializedPage(serialized: string): "pass" | "fail" {
  try {
    assertPageSafe(serialized);
  } catch {
    return "fail";
  }
  if (pageContainsForbiddenContact(serialized)) return "fail";
  if (/"transcript"|recording_url|spreadsheet_id|last_error|phone_raw/.test(serialized)) {
    return "fail";
  }
  return "pass";
}

export function analyzeProofPage(
  page: JobTimelinePage,
  alias: string,
): PageProofNotes {
  const enhanced = isEnhancedJobTimelinePage(page) ? page as EnhancedJobTimelinePage : null;
  return {
    alias,
    proof_shape: page.proof_shape,
    outcome: enhanced?.current_outcome ?? null,
    event_count: page.events.length,
    activity_member_count: enhanced?.activities.reduce((sum, activity) => sum + activity.event_ids.length, 0) ?? 0,
    activity_grouping_preserves_counts: activityGroupingPreservesCounts(page),
    kinds: eventKinds(page),
    attention_codes: enhanced?.attention.map((item) => item.code) ?? [],
    has_pre_job_walkback: hasPreJobWalkback(page),
    has_booking_intake: page.events.some((event) => event.kind === "booking_intake"),
    has_official_booking: page.events.some((event) => event.kind === "official_booking"),
    has_cancellation_intake: page.events.some((event) => event.kind === "cancellation_intake"),
    has_official_cancellation: page.events.some((event) => event.kind === "official_cancellation"),
    forbidden_scan: scanSerializedPage(JSON.stringify(page)),
  };
}

export type ProofSelection = {
  origin_shapes: Partial<Record<JobTimelinePage["proof_shape"], string>>;
  pre_job_walkback: string | null;
  booking_intake_and_official: string | null;
  cancellation_intake: string | null;
  official_cancellation: string | null;
  attention_sample: string | null;
};

export function selectProofAliases(notes: PageProofNotes[]): ProofSelection {
  const first = (predicate: (note: PageProofNotes) => boolean): string | null =>
    notes.find(predicate)?.alias ?? null;

  const origin_shapes: ProofSelection["origin_shapes"] = {};
  for (const shape of ["granot_born", "wordpress_born", "ringcentral_born", "other"] as const) {
    const match = notes.find((note) => note.proof_shape === shape);
    if (match) origin_shapes[shape] = match.alias;
  }

  return {
    origin_shapes,
    pre_job_walkback: first((note) => note.has_pre_job_walkback),
    booking_intake_and_official: first((note) => note.has_booking_intake && note.has_official_booking),
    cancellation_intake: first((note) => note.has_cancellation_intake),
    official_cancellation: first((note) => note.has_official_cancellation),
    attention_sample:
      first((note) => note.attention_codes.length > 0 && note.event_count > 0)
      ?? first((note) => note.attention_codes.length > 0),
  };
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

export function redactProofNotes(notes: PageProofNotes[]): PageProofNotes[] {
  return notes.map((note) => ({
    ...note,
    kinds: [...note.kinds],
    attention_codes: [...note.attention_codes],
  }));
}
