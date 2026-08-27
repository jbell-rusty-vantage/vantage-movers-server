import type {
  EvidenceLevel,
  JobTimelineEvent,
  JobTimelineEventKind,
  JobTimelineStage,
  TimelineCorrelation,
  TimelineEvidenceRef,
} from "./types.js";

export type OwnerFieldGroup =
  | "Contact"
  | "Move"
  | "Assignment"
  | "Attribution"
  | "Job identity"
  | "Booking state"
  | "Other";

const STAGE_BY_KIND: Record<JobTimelineEventKind, JobTimelineStage> = {
  source_received: "origin",
  lead_created: "origin",
  lead_message: "engagement",
  job_number_acquired: "qualification",
  lead_updated: "qualification",
  granot_observation: "processing",
  synchronization_decision: "processing",
  booking_intake: "booking",
  official_booking: "booking",
  cancellation_intake: "cancellation",
  official_cancellation: "cancellation",
  sheet_sync: "delivery",
};

export function stageForKind(kind: JobTimelineEventKind): JobTimelineStage {
  return STAGE_BY_KIND[kind];
}

export function ownerGroupsForPaths(paths: string[]): OwnerFieldGroup[] {
  const groups = new Set<OwnerFieldGroup>();
  for (const path of paths) {
    groups.add(ownerGroupForPath(path));
  }
  return groups.size > 0 ? [...groups] : ["Other"];
}

function ownerGroupForPath(path: string): OwnerFieldGroup {
  if (path === "job_no" || path === "normalized_job_no" || path === "ref_no") {
    return "Job identity";
  }
  if (
    /name|phone|email|contact/.test(path)
    && !path.startsWith("source_")
    && !path.includes("receiver_agent")
  ) {
    return "Contact";
  }
  if (
    /move_|pickup_|delivery_|destination_|cubic_feet|over_2000|over_4000|^local$/.test(path)
  ) {
    return "Move";
  }
  if (/receiver_agent|assigned|agent/.test(path)) {
    return "Assignment";
  }
  if (/source_|ingestion_|crm_source/.test(path)) {
    return "Attribution";
  }
  if (/quoted|booked|cancelled|granot_priority|post_to_granot/.test(path)) {
    return "Booking state";
  }
  return "Other";
}

export function leadUpdateSummary(commandName: string, paths: string[]): string {
  const groups = ownerGroupsForPaths(paths);
  const labels = groups.map((group) => (group === "Move" ? "Move details" : group.toLowerCase()));
  const joined = labels.length === 0
    ? "Lead fields"
    : labels.length === 1
      ? labels[0]
      : labels.length === 2
        ? `${labels[0]} and ${labels[1]}`
        : `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
  const fromGranot = commandName === "synchronizeLeadFromGranot" ? " from Granot" : "";
  return `${joined} updated${fromGranot}.`;
}

export function evidenceLevelFor(event: JobTimelineEvent): EvidenceLevel {
  if (event.kind === "source_received" && event.data.ingress === "ringcentral") {
    return "external_acknowledgement";
  }
  if (event.coverage === "command_backed" && (
    event.kind === "lead_created"
    || event.kind === "lead_updated"
    || event.kind === "job_number_acquired"
    || event.kind === "official_booking"
    || event.kind === "official_cancellation"
  )) {
    return "verified_change";
  }
  if (event.coverage === "official_fact_only") {
    return "official_record";
  }
  if (event.kind === "lead_message") {
    const status = String(event.data.status ?? "");
    if (status === "delivered" || status === "sent" || status === "undelivered") {
      return "external_acknowledgement";
    }
    return "recorded_evidence";
  }
  return "recorded_evidence";
}

export function eventStatus(
  event: JobTimelineEvent,
): "completed" | "active" | "pending" | "failed" | "informational" {
  if (event.kind === "booking_intake" || event.kind === "cancellation_intake") {
    if (event.data.event === "resolved") return "completed";
    if (event.data.state === "open") return "active";
    return "informational";
  }
  if (event.kind === "sheet_sync") {
    const status = String(event.data.status ?? "");
    if (status === "failed") return "failed";
    if (status === "pending" || status === "retrying" || status === "processing") return "pending";
    if (status === "synced") return "completed";
    return "informational";
  }
  if (event.kind === "lead_message") {
    const status = String(event.data.status ?? "");
    if (status === "failed" || status === "undelivered") return "failed";
    if (status === "scheduled" || status === "accepted") return "pending";
    return "completed";
  }
  if (event.kind === "granot_observation" || event.kind === "source_received") {
    return "informational";
  }
  return "completed";
}

export function eventSummary(event: JobTimelineEvent): string | null {
  if (event.kind === "lead_updated") {
    const command = String(event.data.command_name ?? "");
    const paths = Array.isArray(event.data.changed_paths)
      ? event.data.changed_paths.map(String)
      : [];
    return leadUpdateSummary(command, paths);
  }
  if (event.kind === "source_received" && event.data.ingress === "granot") {
    const route = event.data.route_event_class ? String(event.data.route_event_class) : "observation";
    return `Granot Observation Receipt captured (${route}).`;
  }
  if (event.kind === "source_received" && event.data.ingress === "ringcentral") {
    const outcome = event.data.qualification_outcome
      ? String(event.data.qualification_outcome)
      : String(event.data.status ?? "processed");
    return `RingCentral processed qualified call (${outcome}).`;
  }
  return event.headline;
}

export function correlationFor(
  event: JobTimelineEvent,
  input: {
    proof_shape: string;
    job_number_at_create: boolean;
    cancellation_via_snapshot: boolean;
  },
): TimelineCorrelation {
  if (event.kind === "source_received" && event.data.ingress === "granot") {
    return {
      method: "observation_reference",
      confidence: "exact",
      explanation: "Observation Receipt is the durable ingress fact for this Granot Observation.",
    };
  }
  if (event.kind === "source_received" && event.data.ingress === "ringcentral") {
    return {
      method: "lead_reference",
      confidence: "exact",
      explanation: "Processed-call ledger row is correlated to the resolved Call Lead.",
    };
  }
  if (event.kind === "lead_created" && input.proof_shape === "wordpress_born" && !input.job_number_at_create) {
    return {
      method: "lead_reference",
      confidence: "walked_back",
      explanation: "Lead existed before Job Number; the page walked back from later Job-scoped facts.",
    };
  }
  if (event.kind === "lead_created" || event.kind === "lead_message" || event.kind === "lead_updated") {
    return {
      method: "lead_reference",
      confidence: "exact",
      explanation: "Event belongs to the Lead resolved from this Job's walk-back.",
    };
  }
  if (event.kind === "job_number_acquired" && event.clock_field === "record_link.established_at") {
    return {
      method: "record_link",
      confidence: "exact",
      explanation: "Job Number is proven by the Record Link that carries the Lead reference.",
    };
  }
  if (event.kind === "granot_observation" || event.kind === "synchronization_decision") {
    return {
      method: "direct_job_number",
      confidence: "exact",
      explanation: "Row is stored against this Job Number (or an equivalent normalized form).",
    };
  }
  if (event.kind === "sheet_sync") {
    return {
      method: "sheet_entity_reference",
      confidence: "exact",
      explanation: "Sheet Sync job is joined by entity ID of the resolved Lead, Booking, or Cancellation.",
    };
  }
  if (event.kind === "official_booking" || event.kind === "booking_intake") {
    return {
      method: event.kind === "official_booking" ? "booking_reference" : "direct_job_number",
      confidence: "exact",
      explanation: event.kind === "official_booking"
        ? "Official Booking is stored against this Job Number."
        : "Booking intake case is stored against this Job Number.",
    };
  }
  if (event.kind === "official_cancellation") {
    if (input.cancellation_via_snapshot) {
      return {
        method: "direct_job_number",
        confidence: "exact",
        explanation: "Official Cancellation is attached through a durable Job Number snapshot.",
      };
    }
    return {
      method: "booking_reference",
      confidence: "exact",
      explanation: "Official Cancellation is attached through the surviving Booking for this Job.",
    };
  }
  if (event.kind === "cancellation_intake") {
    return {
      method: "direct_job_number",
      confidence: "exact",
      explanation: "Cancellation intake case is stored against this Job Number.",
    };
  }
  return {
    method: "direct_job_number",
    confidence: "exact",
    explanation: "Event is in scope for the typed Job Number.",
  };
}

export function evidenceRefsFor(event: JobTimelineEvent): TimelineEvidenceRef[] {
  const refs: TimelineEvidenceRef[] = [];
  const push = (source_kind: string, safe_label: string, ref: unknown) => {
    if (typeof ref === "string" && ref) {
      refs.push({ source_kind, safe_label, ref });
    }
  };
  push("receipt", "Observation Receipt", event.data.receipt_id);
  push("observation", "Granot Observation", event.data.observation_id);
  push("decision", "Synchronization Decision", event.data.decision_id);
  push("entity_change", "EntityChange", event.kind === "lead_updated" || event.kind === "lead_created"
    ? event.id.split(":").slice(1).join(":")
    : undefined);
  push("lead_message", "Lead Message", event.kind === "lead_message" ? event.id.slice("lead_message:".length) : undefined);
  push("booking", "Official Booking", event.data.booking_id);
  push("cancellation", "Official Cancellation", event.data.cancellation_id);
  push("sheet_sync_job", "Sheet Sync job", event.data.job_id);
  push("case", "Reconciliation case", event.data.case_id);
  if (event.kind === "lead_updated") {
    const command = String(event.data.command_name ?? "");
    const paths = Array.isArray(event.data.changed_paths) ? event.data.changed_paths.map(String) : [];
    if (command) {
      refs.push({ source_kind: "command", safe_label: command, ref: command });
    }
    for (const path of paths) {
      refs.push({ source_kind: "changed_path", safe_label: path, ref: path });
    }
  }
  if (event.kind === "source_received" && event.data.ingress === "ringcentral") {
    push("processed_call", "Processed call ledger", event.id.slice("source_received:ringcentral:".length));
  }
  return refs;
}

