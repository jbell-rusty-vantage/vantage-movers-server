import { getGranotObservationModel, type GranotObservationDocument } from "../../../models/GranotObservation";
import { priorityLabel } from "../outreach/leadProgress";
import { GRANOT_TRACKED_FIELDS, granotTrackedValues, type GranotTrackedField } from "../story/granot";
import { GRANOT_CHANGE_SLACK_MS } from "../story/sources";
import type { StoryEvent, StoryLeadRef } from "../story/types";
import { calendarDate, granotMoney } from "./time";
import type { CaseGranotSource, GranotObservationFacts } from "./types";

/**
 * F5 (spec §4.4): Granot history at read time from accepted observations only, with the last known
 * value per field. No Lead schema change, no trigger, never part of any fingerprint.
 *
 * - Accepted = `normalization_result ∈ {valid, valid_with_issues}`; invalid/unsupported never appear.
 * - A Lead with a Job Number matches by `identity.normalized_job_no` only; a Lead without one by
 *   `contact.normalized_phone`. Newest 50 per Lead, oldest first; the bound marks truncation.
 * - An observation without a field (no money block, no move date) never erases the last known value.
 */
export const ACCEPTED_NORMALIZATION_RESULTS = ["valid", "valid_with_issues"] as const;
export const GRANOT_HISTORY_LIMIT = 50;
const COLLAPSE_MS = 60 * 60 * 1000;
const leadKey = (ref: StoryLeadRef) => `lead:${ref.model}:${ref.id}`;
const iso = (value: unknown) => (value instanceof Date && !Number.isNaN(+value) ? value.toISOString() : null);

export type GranotLeadInput = { ref: StoryLeadRef; normalized_job_no: string | null; normalized_phone: string | null };

/** One indexed query per Lead (`granot_observation_normalized_job_no_captured` / `…_phone_captured`). Read only. */
export async function readAcceptedObservations(leads: readonly GranotLeadInput[], asOf: Date, limit = GRANOT_HISTORY_LIMIT): Promise<CaseGranotSource[]> {
  return Promise.all(leads.map(async lead => {
    const job = lead.normalized_job_no?.trim() || null, phone = lead.normalized_phone?.trim() || null;
    const filter = job ? { "identity.normalized_job_no": job } : phone ? { "contact.normalized_phone": phone } : null;
    if (!filter) return { lead_ref: lead.ref, basis: "none" as const, observations: [], truncated: false };
    const rows = await getGranotObservationModel().find({ ...filter, normalization_result: { $in: [...ACCEPTED_NORMALIZATION_RESULTS] }, captured_at: { $lte: asOf } })
      .select("kind captured_at createdAt normalized_source_label priority display_money move agent_identity normalization_result")
      .sort({ captured_at: -1, _id: -1 }).limit(limit + 1).lean();
    const kept = (rows as unknown as GranotObservationDocument[]).slice(0, limit).reverse();
    return { lead_ref: lead.ref, basis: job ? "job_no" as const : "phone" as const, observations: kept.map(observationFacts), truncated: rows.length > limit };
  }));
}

export function observationFacts(row: Pick<GranotObservationDocument, "_id" | "kind" | "captured_at" | "createdAt" | "normalized_source_label" | "priority" | "display_money" | "move" | "agent_identity">): GranotObservationFacts {
  return { id: String(row._id), kind: row.kind, captured_at: iso(row.captured_at) ?? new Date(0).toISOString(), observed_at: iso(row.createdAt),
    source_label: row.normalized_source_label ?? null, values: granotTrackedValues(row) };
}

export type GranotChange = { field: GranotTrackedField; from: string | null; to: string | null };
export type GranotHistoryEntry = { lead_ref: StoryLeadRef; observation_ids: string[]; happened_at: string; to_at: string; observed_at: string | null;
  baseline: boolean; changes: GranotChange[]; rep: string | null };
export type GranotLastKnown = Partial<Record<GranotTrackedField, { value: string; captured_at: string; since: string; previous: { value: string; changed_at: string } | null }>>;
export type GranotHistory = { lead_ref: StoryLeadRef; entries: GranotHistoryEntry[]; last_known: GranotLastKnown; newest: GranotObservationFacts | null;
  observations: number; truncated: boolean };

/** Pure: accepted observations (oldest first) → the change list and the last known value per field. */
export function granotHistory(source: CaseGranotSource): GranotHistory {
  const observations = [...source.observations].sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const last: GranotLastKnown = {};
  const raw: GranotHistoryEntry[] = [];
  for (const [index, observation] of observations.entries()) {
    const changes: GranotChange[] = [];
    for (const field of GRANOT_TRACKED_FIELDS) {
      const value = observation.values[field];
      if (value === null) continue;
      const known = last[field];
      if (!known) {
        changes.push({ field, from: null, to: value });
        last[field] = { value, captured_at: observation.captured_at, since: observation.captured_at, previous: null };
      } else if (known.value !== value) {
        changes.push({ field, from: known.value, to: value });
        last[field] = { value, captured_at: observation.captured_at, since: observation.captured_at, previous: { value: known.value, changed_at: observation.captured_at } };
      } else last[field] = { ...known, captured_at: observation.captured_at };
    }
    const baseline = index === 0;
    if (!baseline && !changes.length) continue;
    raw.push({ lead_ref: source.lead_ref, observation_ids: [observation.id], happened_at: observation.captured_at, to_at: observation.captured_at, observed_at: observation.observed_at,
      baseline, changes, rep: observation.values.rep_raw });
  }
  return { lead_ref: source.lead_ref, entries: collapseGranotEntries(raw), last_known: last, newest: observations.at(-1) ?? null,
    observations: observations.length, truncated: source.truncated };
}

/** Consecutive changes within one hour collapse (as Priority churn does, `story/catalog.ts`): first `from`, last `to`. */
export function collapseGranotEntries(entries: readonly GranotHistoryEntry[]): GranotHistoryEntry[] {
  const out: GranotHistoryEntry[] = [];
  for (const entry of entries) {
    const previous = out.at(-1);
    if (!previous || Date.parse(entry.happened_at) - Date.parse(previous.to_at) > COLLAPSE_MS) { out.push({ ...entry, changes: [...entry.changes] }); continue; }
    const merged = new Map(previous.changes.map(c => [c.field, { ...c }]));
    for (const change of entry.changes) {
      const prior = merged.get(change.field);
      merged.set(change.field, prior ? { field: change.field, from: prior.from, to: change.to } : { ...change });
    }
    out[out.length - 1] = { ...previous, observation_ids: [...previous.observation_ids, ...entry.observation_ids], to_at: entry.to_at, rep: entry.rep ?? previous.rep,
      changes: GRANOT_TRACKED_FIELDS.flatMap(field => { const c = merged.get(field); return c && (previous.baseline || c.from !== c.to) ? [c] : []; }) };
  }
  return out.filter(e => e.baseline || e.changes.length > 0);
}

/** A history entry as a story event (it replaces `granot_observed` on the Case File timeline, spec §4.4). */
export function granotHistoryEvent(entry: GranotHistoryEntry): StoryEvent {
  const id = `granot_observed:${entry.observation_ids[0]}`;
  return { id, kind: "granot_observed", happened_at: entry.happened_at, observed_at: entry.observed_at ?? entry.happened_at, subject_key: leadKey(entry.lead_ref),
    actor: { kind: "granot", agent_id: null, name: entry.rep, identity_status: null }, record: { record_type: "story_event", record_id: id }, sentence: "",
    detail: { lead_ref: entry.lead_ref, history: true, baseline: entry.baseline, changes: entry.changes, observation_ids: entry.observation_ids, to_at: entry.to_at },
    evidence_refs: entry.observation_ids.map(o => `observation:${o}`) };
}

const leadIdOf = (event: StoryEvent): string | null => {
  const ref = event.detail.lead_ref as { id?: unknown } | null | undefined;
  if (ref && typeof ref === "object" && ref.id) return String(ref.id);
  const match = /^lead:(?:FormLead|CallLead):([a-f0-9]{24})$/.exec(event.subject_key);
  return match ? match[1]! : null;
};

/**
 * The `entity_changes` Priority line stays (it carries the provenance and the `by` rep). When an
 * observation shows the same Priority change within `GRANOT_CHANGE_SLACK_MS`, its other field changes
 * are added to that line (`detail.granot_fields`) and the observation's Priority change is dropped;
 * an entry left with nothing is removed. Pure; returns new arrays.
 */
export function mergeGranotHistory(storyEvents: readonly StoryEvent[], history: readonly GranotHistoryEntry[]): { events: StoryEvent[]; history: GranotHistoryEntry[] } {
  const events = storyEvents.map(e => e);
  const used = new Set<number>();
  const kept: GranotHistoryEntry[] = [];
  for (const entry of history) {
    const priority = entry.changes.find(c => c.field === "priority");
    if (!priority) { kept.push(entry); continue; }
    const at = Date.parse(entry.happened_at);
    let match = -1, best = Number.POSITIVE_INFINITY;
    events.forEach((event, index) => {
      if (used.has(index) || event.kind !== "granot_priority_changed" || leadIdOf(event) !== entry.lead_ref.id) return;
      if (String(event.detail.to ?? "") !== String(priority.to ?? "")) return;
      const distance = Math.abs(Date.parse(event.happened_at) - at);
      if (distance <= GRANOT_CHANGE_SLACK_MS && distance < best) { best = distance; match = index; }
    });
    if (match < 0) { kept.push(entry); continue; }
    used.add(match);
    // The rep who made the change is already the line's `by`; every other field (the Granot rep included) joins the line.
    const others = entry.changes.filter(c => c.field !== "priority" && c.field !== "user_raw" && !(entry.baseline && c.field === "rep_raw"));
    const target = events[match]!;
    events[match] = { ...target, detail: { ...target.detail, granot_fields: [...((target.detail.granot_fields as GranotChange[] | undefined) ?? []), ...others],
      granot_observation_ids: entry.observation_ids }, evidence_refs: [...new Set([...target.evidence_refs, ...entry.observation_ids.map(o => `observation:${o}`)])] };
  }
  return { events, history: kept };
}

const FIELD_LABELS: Record<GranotTrackedField, string> = {
  priority: "Priority", estimate: "estimate", payment: "payment", balance: "balance", move_date: "move date", move_size: "size", cubic_feet: "cubic feet",
  service_type: "service", pickup: "pickup", delivery: "delivery", user_raw: "Granot user", rep_raw: "Granot rep",
};
/** One field value as the Case File prints it: money normalized, move dates as calendar dates, Priority with its label. */
export function granotValueText(field: GranotTrackedField, value: string | null): string {
  if (value === null) return "none";
  switch (field) {
    case "estimate": case "payment": case "balance": return granotMoney(value) ?? "none";
    case "move_date": return calendarDate(value) ?? value;
    case "priority": return `${value} ${priorityLabel(value)}`;
    case "cubic_feet": return `${value} cu ft`;
    default: return value;
  }
}
export function granotChangeText(change: GranotChange): string {
  if (change.field === "cubic_feet") return change.from === null ? `${change.to ?? "none"} cu ft` : `${change.from} → ${change.to ?? "none"} cu ft`;
  const label = FIELD_LABELS[change.field];
  if (change.from === null) return `${label} ${granotValueText(change.field, change.to)}`;
  return `${label} ${granotValueText(change.field, change.from)} → ${granotValueText(change.field, change.to)}`;
}
export const granotFieldLabel = (field: GranotTrackedField) => FIELD_LABELS[field];
