import { z } from "zod";
import { csiIdSchema as id, csiDateSchema as date } from "../../../validation/v1/salesIntelligence";
import { redactTranscript } from "../../conversations/redaction";
import { outreachDtoSchema } from "../dto";
import { normalizePriority, priorityLabel } from "./leadProgress";
import { officialClosure } from "./transitions";

/**
 * Data spec §4.1 / final spec §11.1: the three fields `GET /outreach/:id` adds on
 * `data.outreach` beside the shared Outreach DTO. They are detail-only (the desk
 * rows never carry them), so they live here instead of in `outreachDtoSchema`.
 */
export const OVERVIEW_MAX_CHARS = 280;
export const OFFICIAL_STATUSES = ["open_lead", "booked", "cancelled", "bad_lead", "duplicate", "no_sync"] as const;

export const latestSummaryDtoSchema = z.object({
  run_id: id,
  run_kind: z.enum(["conversation", "number"]),
  completed_at: date.nullable(),
  /** Step-3 synthesis `summary.overview`, redacted, cut by `cutOverview`. */
  overview: z.string().min(1).max(OVERVIEW_MAX_CHARS),
  /** `step_artifacts.summaries.length`; 1 for a legacy conversation run; null when a legacy Number run cannot say. */
  conversations_covered: z.number().int().nonnegative().nullable(),
}).strict();
export const officialStatusDtoSchema = z.object({
  status: z.enum(OFFICIAL_STATUSES),
  booking_id: id.nullable(),
  priority: z.object({ code: z.string(), label: z.string() }).strict().nullable(),
}).strict();
export const outreachDetailAdditionsShape = {
  newest_run_id: id.nullable(),
  latest_summary: latestSummaryDtoSchema.nullable(),
  /** Null when the subject is not a Lead (Number-only Outreach) or the Lead row is gone. */
  official: officialStatusDtoSchema.nullable(),
};
/** `data.outreach` on `GET /outreach/:id`: the shared Outreach DTO plus the §4.1 fields. */
export const outreachDetailDtoSchema = outreachDtoSchema.extend(outreachDetailAdditionsShape).strict();
export type LatestSummaryDto = z.infer<typeof latestSummaryDtoSchema>;
export type OfficialStatusDto = z.infer<typeof officialStatusDtoSchema>;

const ABBREVIATIONS = new Set(["mr", "mrs", "ms", "dr", "st", "jr", "sr", "vs", "etc", "e.g", "i.e", "approx", "ave", "no", "apt", "ft", "lbs", "est"]);
/** A `.`/`!`/`?` (optionally followed by closing quotes or brackets) that ends a sentence. */
function sentenceEnds(text: string): number[] {
  const ends: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (!".!?".includes(text[i]!)) continue;
    let end = i + 1;
    while (end < text.length && `"')]’”`.includes(text[end]!)) end++;
    if (end < text.length && !/\s/.test(text[end]!)) continue;
    if (text[i] === ".") {
      const word = /([A-Za-z.]+)$/.exec(text.slice(0, i))?.[1]?.toLowerCase() ?? "";
      if (ABBREVIATIONS.has(word) || /^[a-z]$/i.test(word)) continue;
    }
    ends.push(end);
  }
  return ends;
}

/**
 * Final spec §11.1: the overview redacted, whitespace collapsed, and — when longer
 * than `max` — cut at the last sentence boundary that leaves room for ` …`. One
 * sentence longer than the budget is cut at the last word boundary instead, and a
 * single unbroken token hard-cut. The result is never longer than `max`; empty input is null.
 */
export function cutOverview(raw: unknown, max = OVERVIEW_MAX_CHARS): string | null {
  if (typeof raw !== "string") return null;
  const text = redactTranscript(raw).text.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text.length <= max) return text;
  const budget = max - 2; // room for " …"
  const sentence = sentenceEnds(text).filter(end => end <= budget).at(-1);
  if (sentence) return `${text.slice(0, sentence)} …`;
  const word = text.lastIndexOf(" ", budget);
  return word > 0 ? `${text.slice(0, word).replace(/[\s,;:–—-]+$/, "")} …` : `${text.slice(0, max - 1)}…`;
}

type RunLite = { _id: unknown; conversation_id?: unknown; completed_at?: Date | null; output?: unknown; step_artifacts?: unknown };
/** §4.1 `latest_summary` from the one newest-completed-run read; null when the run carries no usable overview. */
export function latestSummaryFromRun(run: RunLite | null): LatestSummaryDto | null {
  if (!run) return null;
  const overview = cutOverview((run.output as { summary?: { overview?: unknown } } | null | undefined)?.summary?.overview);
  if (!overview) return null;
  const summaries = (run.step_artifacts as { summaries?: unknown } | null | undefined)?.summaries;
  const conversation = Boolean(run.conversation_id);
  return latestSummaryDtoSchema.parse({
    run_id: String(run._id), run_kind: conversation ? "conversation" : "number",
    completed_at: run.completed_at?.toISOString() ?? null, overview,
    // Legacy (pre-structured) runs have no step artifacts: a conversation run covered its one call; a Number run cannot say.
    conversations_covered: Array.isArray(summaries) ? summaries.length : conversation ? 1 : null,
  });
}

type LeadFlags = { duplicate?: boolean | null; bad_lead?: unknown; booked?: unknown; cancelled?: unknown; no_sync?: boolean | null; granot_priority?: unknown };
type BookingLite = { _id: unknown; book_date?: Date | null };
/**
 * §4.1 `official` from data the detail read already holds: the Lead's official flags
 * (`officialClosure`), then the exact `booked_leads` / `cancelled_leads` rows
 * (`authoritativeClosure` without its extra reads), plus the Granot Priority label.
 */
export function officialStatus(lead: LeadFlags | null, bookings: readonly BookingLite[], cancelledBookingIds: ReadonlySet<string>): OfficialStatusDto | null {
  if (!lead) return null;
  const newest = [...bookings].sort((a, b) => (+(b.book_date ?? 0) - +(a.book_date ?? 0)) || String(b._id).localeCompare(String(a._id)))[0] ?? null;
  const exact = newest ? (cancelledBookingIds.has(String(newest._id)) ? "cancelled" : "booked") : null;
  const mirrored = officialClosure({ booked: lead.booked, cancelled: lead.cancelled, bad_lead: lead.bad_lead, duplicate: lead.duplicate ?? undefined, no_sync: lead.no_sync ?? undefined });
  const status = (mirrored ?? exact ?? "open_lead") as OfficialStatusDto["status"];
  const code = normalizePriority(lead.granot_priority);
  return officialStatusDtoSchema.parse({ status, booking_id: newest ? String(newest._id) : null,
    priority: code === null ? null : { code, label: priorityLabel(code) } });
}
