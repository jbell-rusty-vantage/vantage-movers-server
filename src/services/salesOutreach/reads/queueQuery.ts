import mongoose from "mongoose";
import type { SalesOutreachQueueSort, SalesOutreachQueueState } from "../../../config/domain/salesOutreach";
import { normalizeJobNo } from "../../bookings/bookingIdentity";
import { foldName } from "../evaluation/projection";

/**
 * The queue's filter and order as data (CONTRACTS "GET /queue", "Queue sort enums"; SPECIFICATION §7).
 *
 * One plan drives both stores: `mongoQueueFilter`/`mongoQueueSort` translate it for MongoDB (every
 * predicate and the order run in the database over the full result set before paging, on the declared
 * `sod_projection_q_*` indexes) and `matchesQueue`/`compareQueueRows` give the same semantics to the
 * in-memory test store. All sort keys are non-null (`queue_keys` sentinels), so no null ordering is
 * ever left to either implementation; the subject id is the stable final tie.
 */

export type QueueAssignment =
  | Readonly<{ kind: "all" }>
  | Readonly<{ kind: "agent"; agent_id: string }>
  | Readonly<{ kind: "unassigned" }>;

export type QueueSearch = Readonly<{
  /** Folded (NFKC, lower-case) literal name substring. */
  name: string;
  /** Normalized Job Number literal prefix; null when the text normalizes to nothing. */
  job_prefix: string | null;
  /** Phone digits literal substring; null below four digits (SPECIFICATION §7). */
  phone_digits: string | null;
}>;

export type QueueMatch = Readonly<{
  assignment: QueueAssignment;
  state: SalesOutreachQueueState;
  priority: Readonly<{ kind: "all" }> | Readonly<{ kind: "unknown" }> | Readonly<{ kind: "code"; code: string }>;
  workflow: "new" | "quoted" | "discretion" | "none" | null;
  move_date: Readonly<{ from: string | null; to: string | null; unknown: "include" | "exclude" | "only" }> | null;
  search: QueueSearch | null;
}>;

export type QueueSortField =
  | "queue_keys.urgency_due"
  | "queue_keys.urgency_next"
  | "queue_keys.received_asc"
  | "queue_keys.received_desc"
  | "queue_keys.last_interaction"
  | "subject_id";
export type QueueSortSpec = ReadonlyArray<Readonly<{ field: QueueSortField; dir: 1 | -1 }>>;

/** Keyset position after the last row of a page: one ISO instant per date key, then the subject id. */
export type QueueKeyset = readonly string[];

export type QueuePagePlan = Readonly<{ match: QueueMatch; sort: QueueSortSpec; after: QueueKeyset | null; limit: number }>;

/** The stored sort keys a row carries (`sales_outreach_projections.queue_keys`). */
export type QueueKeys = Readonly<{
  urgency_due: Date;
  urgency_next: Date;
  call_due: Date;
  received_asc: Date;
  received_desc: Date;
  last_interaction: Date;
}>;

/** The fields of a stored projection row the queue matches on. */
export type QueueMatchable = Readonly<{
  subject_id: string;
  assigned_agent_id: string | null;
  subject_status: "active" | "closed" | "review";
  priority_raw: string | null;
  workflow: string | null;
  status_flags: Readonly<Record<string, boolean>>;
  display: Readonly<{ normalized_job_no: string | null; normalized_phone: string | null; name_folded: string | null; move_date: string | null }>;
  queue_keys: QueueKeys;
}>;

/** Sort direction applied for a sort; urgency is fixed (CONTRACTS). */
export function queueDirectionOf(sort: SalesOutreachQueueSort, requested: "asc" | "desc" | undefined): "asc" | "desc" {
  if (sort === "urgency") return "asc";
  if (requested) return requested;
  return sort === "lead_received" ? "desc" : "asc";
}

/**
 * Most overdue: earliest unsatisfied actionable deadline, next action due, received oldest-first, id.
 * Lead received: newest first by default; unknown last in both directions (separate sentinel keys).
 * Last interaction: oldest first by default with never-contacted first; never-contacted last descending.
 */
export function queueSortSpec(sort: SalesOutreachQueueSort, direction: "asc" | "desc"): QueueSortSpec {
  if (sort === "urgency")
    return [
      { field: "queue_keys.urgency_due", dir: 1 },
      { field: "queue_keys.urgency_next", dir: 1 },
      { field: "queue_keys.received_asc", dir: 1 },
      { field: "subject_id", dir: 1 },
    ];
  const dir = direction === "asc" ? 1 : -1;
  if (sort === "lead_received")
    return [
      { field: dir === 1 ? "queue_keys.received_asc" : "queue_keys.received_desc", dir },
      { field: "subject_id", dir },
    ];
  return [
    { field: "queue_keys.last_interaction", dir },
    { field: "subject_id", dir },
  ];
}

/** The search plan for a trimmed literal (≤ 100 characters, already validated). */
export function queueSearchOf(text: string | undefined): QueueSearch | null {
  const trimmed = text?.trim() ?? "";
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  return {
    name: foldName(trimmed) ?? trimmed.toLowerCase(),
    job_prefix: normalizeJobNo(trimmed) ?? null,
    phone_digits: digits.length >= 4 ? digits : null,
  };
}

/** Escapes a literal for a regular expression (search is literal, never a pattern). */
export const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const oid = (id: string) => new mongoose.Types.ObjectId(id);
const LISTED_STATUSES = ["active", "review"] as const;

function stateFilter(state: SalesOutreachQueueState): Record<string, unknown> {
  switch (state) {
    case "needs_contact":
      return { subject_status: "active", "status_flags.needs_contact": true };
    case "all_active":
      return { subject_status: { $in: [...LISTED_STATUSES] } };
    case "blocked":
      return { subject_status: { $in: [...LISTED_STATUSES] }, "status_flags.blocked": true };
    case "pending":
      return { subject_status: { $in: [...LISTED_STATUSES] }, $or: [{ "status_flags.pending": true }, { subject_status: "review" }] };
  }
}

export function mongoAssignmentFilter(assignment: QueueAssignment): Record<string, unknown> {
  if (assignment.kind === "agent") return { assigned_agent_id: oid(assignment.agent_id) };
  if (assignment.kind === "unassigned") return { assigned_agent_id: null };
  return {};
}

/** The MongoDB filter for a match (no keyset). */
export function mongoQueueFilter(match: QueueMatch): Record<string, unknown> {
  const and: Record<string, unknown>[] = [mongoAssignmentFilter(match.assignment), stateFilter(match.state)];
  if (match.priority.kind === "unknown") and.push({ priority_raw: null });
  if (match.priority.kind === "code") and.push({ priority_raw: match.priority.code });
  if (match.workflow) and.push({ workflow: match.workflow });
  if (match.move_date) {
    const { from, to, unknown } = match.move_date;
    const range: Record<string, string> = {};
    if (from) range.$gte = from;
    if (to) range.$lte = to;
    const hasRange = Object.keys(range).length > 0;
    if (unknown === "only") and.push({ "display.move_date": null });
    else if (hasRange && unknown === "include") and.push({ $or: [{ "display.move_date": range }, { "display.move_date": null }] });
    else if (hasRange) and.push({ "display.move_date": range });
    else if (unknown === "exclude") and.push({ "display.move_date": { $ne: null } });
  }
  if (match.search) {
    const or: Record<string, unknown>[] = [{ "display.name_folded": { $regex: escapeRegex(match.search.name) } }];
    if (match.search.job_prefix) or.push({ "display.normalized_job_no": { $regex: `^${escapeRegex(match.search.job_prefix)}` } });
    if (match.search.phone_digits) or.push({ "display.normalized_phone": { $regex: escapeRegex(match.search.phone_digits) } });
    and.push({ $or: or });
  }
  const parts = and.filter((part) => Object.keys(part).length > 0);
  return parts.length === 1 ? parts[0]! : { $and: parts };
}

const keyValue = (field: QueueSortField, value: string) => (field === "subject_id" ? oid(value) : new Date(value));

/** Strictly after `after` in `sort` order (lexicographic expansion over non-null keys). */
export function mongoKeysetFilter(sort: QueueSortSpec, after: QueueKeyset): Record<string, unknown> {
  const or: Record<string, unknown>[] = [];
  for (let i = 0; i < sort.length; i++) {
    const clause: Record<string, unknown> = {};
    for (let j = 0; j < i; j++) clause[sort[j]!.field] = keyValue(sort[j]!.field, after[j]!);
    const { field, dir } = sort[i]!;
    clause[field] = { [dir === 1 ? "$gt" : "$lt"]: keyValue(field, after[i]!) };
    or.push(clause);
  }
  return { $or: or };
}

export function mongoQueueQuery(plan: QueuePagePlan): { filter: Record<string, unknown>; sort: Record<string, 1 | -1> } {
  const base = mongoQueueFilter(plan.match);
  const filter = plan.after ? { $and: [base, mongoKeysetFilter(plan.sort, plan.after)] } : base;
  return { filter, sort: Object.fromEntries(plan.sort.map(({ field, dir }) => [field, dir])) };
}

// ---------------------------------------------------------------------------
// In-memory semantics (the test store), identical to the Mongo translation.
// ---------------------------------------------------------------------------

function sortValue(row: QueueMatchable, field: QueueSortField): number | string {
  if (field === "subject_id") return row.subject_id;
  const key = field.slice("queue_keys.".length) as keyof QueueKeys;
  return +row.queue_keys[key];
}

const cmp = (a: number | string, b: number | string) => (a < b ? -1 : a > b ? 1 : 0);

export function compareQueueRows(sort: QueueSortSpec, a: QueueMatchable, b: QueueMatchable): number {
  for (const { field, dir } of sort) {
    const c = cmp(sortValue(a, field), sortValue(b, field));
    if (c !== 0) return c * dir;
  }
  return 0;
}

/** The row's keyset (for the next cursor), as stored strings. */
export function keysetOf(sort: QueueSortSpec, row: QueueMatchable): string[] {
  return sort.map(({ field }) => {
    if (field === "subject_id") return row.subject_id;
    return row.queue_keys[field.slice("queue_keys.".length) as keyof QueueKeys].toISOString();
  });
}

function afterKeyset(sort: QueueSortSpec, row: QueueMatchable, after: QueueKeyset): boolean {
  for (let i = 0; i < sort.length; i++) {
    const { field, dir } = sort[i]!;
    const stored = field === "subject_id" ? after[i]! : +new Date(after[i]!);
    const c = cmp(sortValue(row, field), stored) * dir;
    if (c !== 0) return c > 0;
  }
  return false;
}

export function matchesQueue(match: QueueMatch, row: QueueMatchable): boolean {
  const a = match.assignment;
  if (a.kind === "agent" && row.assigned_agent_id !== a.agent_id) return false;
  if (a.kind === "unassigned" && row.assigned_agent_id !== null) return false;
  const listed = row.subject_status === "active" || row.subject_status === "review";
  switch (match.state) {
    case "needs_contact":
      if (row.subject_status !== "active" || !row.status_flags.needs_contact) return false;
      break;
    case "all_active":
      if (!listed) return false;
      break;
    case "blocked":
      if (!listed || !row.status_flags.blocked) return false;
      break;
    case "pending":
      if (!listed || !(row.status_flags.pending || row.subject_status === "review")) return false;
      break;
  }
  if (match.priority.kind === "unknown" && row.priority_raw !== null) return false;
  if (match.priority.kind === "code" && row.priority_raw !== match.priority.code) return false;
  if (match.workflow && row.workflow !== match.workflow) return false;
  if (match.move_date) {
    const { from, to, unknown } = match.move_date;
    const date = row.display.move_date;
    const hasRange = Boolean(from || to);
    const inRange = date !== null && (!from || date >= from) && (!to || date <= to);
    if (unknown === "only" && date !== null) return false;
    if (unknown !== "only" && hasRange && !(inRange || (unknown === "include" && date === null))) return false;
    if (unknown === "exclude" && !hasRange && date === null) return false;
  }
  if (match.search) {
    const s = match.search;
    const hit =
      (row.display.name_folded ?? "").includes(s.name) ||
      (s.job_prefix !== null && (row.display.normalized_job_no ?? "").startsWith(s.job_prefix)) ||
      (s.phone_digits !== null && (row.display.normalized_phone ?? "").includes(s.phone_digits));
    if (!hit) return false;
  }
  return true;
}

/** The in-memory page: filter the full set, order it, then take the keyset page. */
export function memoryQueuePage<T extends QueueMatchable>(rows: readonly T[], plan: QueuePagePlan): T[] {
  return rows
    .filter((row) => matchesQueue(plan.match, row))
    .filter((row) => !plan.after || afterKeyset(plan.sort, row, plan.after))
    .sort((a, b) => compareQueueRows(plan.sort, a, b))
    .slice(0, plan.limit);
}
