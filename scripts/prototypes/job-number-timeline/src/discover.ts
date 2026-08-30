import { hasSuccessfulLeadMessage } from "../../../../src/services/jobNumberTimeline/assemble.js";
import type {
  JobTimelineEvent,
  JobTimelinePage,
  JobTimelineProofShape,
} from "../../../../src/services/jobNumberTimeline/types.js";

export type DiscoverScoreInput = {
  page: JobTimelinePage;
};

export type DiscoverRow = {
  normalized_job_no: string;
  job_no_snapshot: string | null;
  source_granularity_label: string | null;
  score: number;
  present_kinds: string[];
  proof_shape: JobTimelineProofShape;
};

function eventAt(page: JobTimelinePage, kind: JobTimelineEvent["kind"]): string | undefined {
  return page.events.find((row) => row.kind === kind)?.event_at;
}

export function scoreJobNumberTimeline(page: JobTimelinePage): number {
  let score = 0;
  const kinds = new Set(page.events.map((row) => row.kind));
  if (kinds.has("lead_created")) score += 1;
  if (hasSuccessfulLeadMessage(page.events)) score += 1;
  const createdAt = eventAt(page, "lead_created");
  const acquiredAt = eventAt(page, "job_number_acquired");
  if (kinds.has("lead_updated") || (createdAt && acquiredAt && createdAt < acquiredAt)) {
    score += 1;
  }
  if (kinds.has("granot_observation")) score += 1;
  if (kinds.has("synchronization_decision")) score += 1;
  if (page.events.some((row) => row.kind === "booking_intake" && row.data.event !== "refreshed")) {
    score += 1;
  }
  if (page.events.some((row) => row.kind === "cancellation_intake" && row.data.event !== "refreshed")) {
    score += 1;
  }
  if (createdAt && acquiredAt && createdAt < acquiredAt) score += 2;
  if (page.coverage.official_booking) score += 1;
  if (page.coverage.official_cancellation) score += 1;
  if (page.events.some((row) => row.kind === "sheet_sync" && row.data.status === "synced")) {
    score += 1;
  }
  return score;
}

export function discoverJobNumberTimelines(
  pages: JobTimelinePage[],
  options: { limit?: number; minScore?: number } = {},
): DiscoverRow[] {
  const minScore = options.minScore ?? 4;
  const limit = options.limit ?? 20;
  return pages
    .map((page) => ({
      page,
      score: scoreJobNumberTimeline(page),
    }))
    .filter((row) => row.score >= minScore)
    .sort((left, right) => right.score - left.score || left.page.normalized_job_no.localeCompare(right.page.normalized_job_no))
    .slice(0, limit)
    .map(({ page, score }) => ({
      normalized_job_no: page.normalized_job_no,
      job_no_snapshot: page.job_no_snapshot,
      source_granularity_label: page.source.source_granularity_label,
      score,
      present_kinds: [...new Set(page.events.map((row) => row.kind))],
      proof_shape: page.proof_shape,
    }));
}
