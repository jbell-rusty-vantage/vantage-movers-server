import {
  evaluateAttention,
  evaluateFreshness,
  evaluateLimitations,
  hasProcessingEvidenceGap,
} from "./attention.js";
import { compareOccurredThenPriority, selectEventTime } from "./clocks.js";
import {
  correlationFor,
  evidenceLevelFor,
  evidenceRefsFor,
  eventStatus,
  eventSummary,
  stageForKind,
} from "./evidence.js";
import { assessStages, evaluateCurrentOutcome, outcomeHeadline } from "./outcome.js";
import type { JobTimelineRows } from "./rows.js";
import type {
  EnhancedJobTimelineEvent,
  EnhancedJobTimelinePage,
  JobTimelineEvent,
  JobTimelinePage,
  JobTimelineStage,
  TimelineActivity,
  TimelineLimitation,
} from "./types.js";
import { JOB_TIMELINE_EVENT_CAP } from "./types.js";

export type ProjectEnhancedPageInput = {
  page: JobTimelinePage;
  rows: JobTimelineRows;
  now?: Date;
  cancellationViaSnapshot?: boolean;
};

function originLabel(page: JobTimelinePage): string {
  if (page.source.source_granularity_label) return page.source.source_granularity_label;
  if (page.source.source_company_label) return page.source.source_company_label;
  if (page.proof_shape === "wordpress_born") return "WordPress";
  if (page.proof_shape === "granot_born") return "Granot";
  if (page.proof_shape === "ringcentral_born") return "RingCentral";
  return "Unknown origin";
}

function observationIdOf(event: JobTimelineEvent): string | undefined {
  if (typeof event.data.observation_id === "string" && event.data.observation_id) {
    return event.data.observation_id;
  }
  if (event.kind === "granot_observation") {
    return event.id.slice("granot_observation:".length);
  }
  return undefined;
}

function receiptIdOf(event: JobTimelineEvent): string | undefined {
  return typeof event.data.receipt_id === "string" && event.data.receipt_id
    ? event.data.receipt_id
    : undefined;
}

function activityHeading(events: EnhancedJobTimelineEvent[]): string {
  const observation = events.find((event) => event.kind === "granot_observation");
  if (observation) {
    const route = observation.data.route_event_class
      ? String(observation.data.route_event_class)
      : "observation";
    return `Granot ${route}`;
  }
  const receipt = events.find((event) => event.kind === "source_received");
  if (receipt) return receipt.headline;
  const official = events.find((event) =>
    event.kind === "official_booking" || event.kind === "official_cancellation",
  );
  if (official) return official.headline;
  return events[0]?.headline ?? "Activity";
}

function assignActivityIds(events: JobTimelineEvent[], rows: JobTimelineRows): Map<string, string> {
  const assigned = new Map<string, string>();
  const observations = rows.observations ?? [];

  for (const observation of observations) {
    const activityId = `activity:observation:${observation.id}`;
    const decision = events.find((event) =>
      event.kind === "synchronization_decision" && event.data.observation_id === observation.id,
    );
    const waveTime = decision?.event_at ?? observation.captured_at;

    for (const event of events) {
      if (assigned.has(event.id)) continue;
      if (event.kind === "lead_created") continue;
      if (event.kind === "official_booking" || event.kind === "official_cancellation") continue;

      const sameObservation = observationIdOf(event) === observation.id;
      const sameReceipt = Boolean(observation.receipt_id && receiptIdOf(event) === observation.receipt_id);
      const sameWaveChange = (
        (event.kind === "lead_updated" || event.kind === "job_number_acquired")
        && event.event_at === waveTime
      );
      const sameWaveSheet = event.kind === "sheet_sync" && (
        event.event_at === waveTime
        || (typeof event.data.requested_at === "string" && event.data.requested_at === waveTime)
      );

      if (sameObservation || sameReceipt || sameWaveChange || sameWaveSheet) {
        assigned.set(event.id, activityId);
      }
    }
  }

  for (const event of events) {
    if (assigned.has(event.id)) continue;
    if (event.kind === "source_received" && event.data.ingress === "ringcentral") {
      assigned.set(event.id, `activity:source:ringcentral:${event.id}`);
      continue;
    }
    if (event.kind === "official_booking") {
      assigned.set(event.id, `activity:booking:${String(event.data.booking_id ?? event.id)}`);
      continue;
    }
    if (event.kind === "official_cancellation") {
      assigned.set(event.id, `activity:cancellation:${String(event.data.cancellation_id ?? event.id)}`);
      continue;
    }
    if (event.kind === "lead_created") {
      assigned.set(event.id, `activity:lead:${event.id}`);
      continue;
    }
    assigned.set(event.id, `activity:event:${event.id}`);
  }

  return assigned;
}

function applyCausality(
  events: EnhancedJobTimelineEvent[],
): EnhancedJobTimelineEvent[] {
  const byActivity = new Map<string, EnhancedJobTimelineEvent[]>();
  for (const event of events) {
    const list = byActivity.get(event.causality.activity_id) ?? [];
    list.push(event);
    byActivity.set(event.causality.activity_id, list);
  }

  const caused = new Map<string, { caused_by_event_ids: string[]; resulting_event_ids: string[] }>();
  for (const group of byActivity.values()) {
    const ordered = [...group].sort(compareOccurredThenPriority);
    for (let index = 0; index < ordered.length; index += 1) {
      const current = ordered[index];
      caused.set(current.id, {
        caused_by_event_ids: index > 0 ? [ordered[index - 1].id] : [],
        resulting_event_ids: index < ordered.length - 1 ? [ordered[index + 1].id] : [],
      });
    }
  }

  return events.map((event) => {
    const links = caused.get(event.id) ?? { caused_by_event_ids: [], resulting_event_ids: [] };
    return {
      ...event,
      causality: {
        activity_id: event.causality.activity_id,
        ...links,
      },
    };
  });
}

function buildActivities(events: EnhancedJobTimelineEvent[]): TimelineActivity[] {
  const groups = new Map<string, EnhancedJobTimelineEvent[]>();
  for (const event of events) {
    const list = groups.get(event.causality.activity_id) ?? [];
    list.push(event);
    groups.set(event.causality.activity_id, list);
  }

  return [...groups.entries()].map(([activity_id, members]) => {
    const ordered = [...members].sort(compareOccurredThenPriority);
    return {
      activity_id,
      heading: activityHeading(ordered),
      event_ids: ordered.map((event) => event.id),
      started_at: ordered[0]?.time.occurred_at ?? "",
      ended_at: ordered[ordered.length - 1]?.time.occurred_at ?? "",
    };
  }).sort((left, right) => left.started_at.localeCompare(right.started_at) || left.activity_id.localeCompare(right.activity_id));
}

function countByStage(events: EnhancedJobTimelineEvent[]): Partial<Record<JobTimelineStage, number>> {
  const counts: Partial<Record<JobTimelineStage, number>> = {};
  for (const event of events) {
    counts[event.stage] = (counts[event.stage] ?? 0) + 1;
  }
  return counts;
}

function truncationLimitation(dropped: EnhancedJobTimelineEvent[]): TimelineLimitation {
  return {
    code: "TIMELINE_TRUNCATED",
    reason_code: "TIMELINE_TRUNCATED",
    label: `Timeline truncated at ${JOB_TIMELINE_EVENT_CAP} events; ${dropped.length} later events omitted.`,
    event_ids: dropped.map((event) => event.id),
    counts_by_stage: countByStage(dropped),
  };
}

function assembledAt(page: JobTimelinePage, now?: Date): string {
  if (now) return now.toISOString();
  const latest = page.events[page.events.length - 1]?.event_at;
  return latest || "1970-01-01T00:00:00.000Z";
}

export function projectEnhancedPage(input: ProjectEnhancedPageInput): EnhancedJobTimelinePage {
  const activityIds = assignActivityIds(input.page.events, input.rows);
  const enhanced = input.page.events.map((event) => {
    const time = selectEventTime(event, input.rows);
    const enhancedEvent: EnhancedJobTimelineEvent = {
      ...event,
      event_at: time.occurred_at,
      clock_field: time.occurred_at_field,
      stage: stageForKind(event.kind),
      evidence_level: evidenceLevelFor(event),
      time,
      summary: eventSummary(event),
      status: eventStatus(event),
      correlation: correlationFor(event, {
        proof_shape: input.page.proof_shape,
        job_number_at_create: input.page.coverage.job_number_at_create,
        cancellation_via_snapshot: Boolean(input.cancellationViaSnapshot),
      }),
      causality: {
        activity_id: activityIds.get(event.id) ?? `activity:event:${event.id}`,
        caused_by_event_ids: [],
        resulting_event_ids: [],
      },
      evidence: evidenceRefsFor(event),
    };
    return enhancedEvent;
  });

  const withCausality = applyCausality(enhanced);
  const dropped = withCausality.length > JOB_TIMELINE_EVENT_CAP
    ? withCausality.slice(JOB_TIMELINE_EVENT_CAP)
    : [];
  const kept = dropped.length > 0 ? withCausality.slice(0, JOB_TIMELINE_EVENT_CAP) : withCausality;
  const keptIds = new Set(kept.map((event) => event.id));
  const activities = buildActivities(kept);
  const assembled_at = assembledAt(input.page, input.now);
  const now = input.now ?? new Date(assembled_at);
  const freshness = evaluateFreshness({ assembled_at, rows: input.rows });
  const current_outcome = evaluateCurrentOutcome({
    coverage: input.page.coverage,
    events: kept,
  });
  const processingGap = hasProcessingEvidenceGap({ rows: input.rows, events: kept });
  const stage_assessments = assessStages({
    coverage: input.page.coverage,
    events: kept,
    processingGap,
  });
  const attention = evaluateAttention({
    page: input.page,
    events: kept,
    rows: input.rows,
    now,
  });
  const truncated: TimelineLimitation[] = dropped.length > 0
    ? [truncationLimitation(dropped)]
    : [];
  const limitations = evaluateLimitations({
    page: input.page,
    events: kept,
    existing: truncated,
    ringcentral_covered_through: freshness.ringcentral_covered_through,
  });

  return {
    ...input.page,
    schema_version: "job_timeline.v2",
    assembled_at,
    current_outcome,
    summary: {
      headline: outcomeHeadline(current_outcome),
      origin_label: originLabel(input.page),
      latest_activity_at: kept[kept.length - 1]?.time.occurred_at ?? null,
      event_count: kept.length,
      attention_count: attention.length,
    },
    freshness,
    stage_assessments,
    attention,
    limitations,
    activities,
    events: kept.map((event) => ({
      ...event,
      causality: {
        ...event.causality,
        caused_by_event_ids: event.causality.caused_by_event_ids.filter((id) => keptIds.has(id)),
        resulting_event_ids: event.causality.resulting_event_ids.filter((id) => keptIds.has(id)),
      },
    })),
  };
}
