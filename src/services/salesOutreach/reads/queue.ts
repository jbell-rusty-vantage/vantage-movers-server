import type { SalesOutreachCadenceExposure, SalesOutreachQueueSort } from "../../../config/domain/salesOutreach";
import { getAdminProxySigningSecret } from "../../operationsRegistry/config";
import {
  SALES_OUTREACH_QUEUE_DEFAULT_LIMIT,
  type SalesOutreachQueueDto,
  type SalesOutreachQueueQuery,
} from "../../../validation/v1/salesOutreachReads";
import type { OutreachActor } from "../auth";
import type { ActiveConfiguration } from "../config/load";
import { OutreachError } from "../errors";
import { cadenceExposureOf, deskEnginePolicy, deskPolicyFingerprint } from "../evaluation/policyAdapter";
import { newYorkBusinessDay } from "./businessDay";
import { mongoDeskQueueStore, type DeskQueueStore } from "./deskStore";
import { presentQueueRow, type StoredQueueRow } from "./present";
import {
  assertCursorCurrent,
  decodeQueueCursor,
  encodeQueueCursor,
  QUEUE_CURSOR_TTL_MS,
  QUEUE_CURSOR_VERSION,
  queueQueryHash,
  type CursorBinding,
} from "./queueCursor";
import { keysetOf, queueDirectionOf, queueSearchOf, queueSortSpec, type QueueAssignment, type QueueMatch } from "./queueQuery";
import { commonRead, readFreshness, requireDeskConfiguration, type DeskReadDeps } from "./common";
import { mongoSalesOutreachReadStore } from "./store";
import { authorizedPoolWorks, readPoolStates, readPoolSummary, poolQueueOverrides } from "../pool/reads";

/**
 * `GET /queue` (SRV-8; CONTRACTS "GET /queue", SPECIFICATION §7).
 *
 * - Scope is server-side: a Rep is forced to its own current assignment (a foreign `agent_id` or
 *   `unassigned` is 403, never broadened); Owner/Manager may filter one rep or Unassigned.
 * - Every predicate and the order run in Mongo over the full result set before paging (`queueQuery.ts`).
 * - Time status is derived at one reference instant: page one's `as_of`, carried by the cursor.
 * - A Rep's page is re-checked against each Lead's authoritative `receiver_agent` before serializing,
 *   so a reassignment revokes the row immediately even while the projection lags.
 * - The cursor is signed and bound to the query, scope, assignment generation, configuration version
 *   and projection snapshot; any mismatch, tamper or expiry is 409 `CURSOR_EXPIRED`.
 */

export type DeskQueueDeps = DeskReadDeps & Readonly<{ cursorSecret?: string | null }>;

export type DeskCadence = Readonly<{ exposure: SalesOutreachCadenceExposure; snapshot: string }>;

/** The exposure and projection snapshot the reads present, or why cadence data cannot be shown (fail closed). */
export function deskCadenceOf(configuration: ActiveConfiguration): DeskCadence | { unavailable: "cadence_disabled" | "policy_unavailable" } {
  const exposure = cadenceExposureOf(configuration.value.controls);
  if (!exposure) return { unavailable: "cadence_disabled" };
  const resolved = deskEnginePolicy(configuration.value);
  if (!resolved.ok) return { unavailable: "policy_unavailable" };
  return { exposure, snapshot: deskPolicyFingerprint(configuration.value, resolved.policy, exposure) };
}

export function requireDeskCadence(configuration: ActiveConfiguration): DeskCadence {
  const cadence = deskCadenceOf(configuration);
  if ("unavailable" in cadence) {
    if (cadence.unavailable === "cadence_disabled")
      throw new OutreachError("PROJECTION_PENDING", [{ path: "controls", code: "cadence_disabled" }]);
    throw new OutreachError("CONFIGURATION_UNAVAILABLE", [{ path: "cadence", code: "policy_unavailable" }]);
  }
  return cadence;
}

/** The assignment scope a query may read: a Rep only itself; Owner/Manager everyone, one rep or Unassigned. */
export function queueAssignmentOf(actor: OutreachActor, query: Pick<SalesOutreachQueueQuery, "agent_id" | "unassigned">): QueueAssignment {
  const unassigned = query.unassigned === "true";
  if (actor.role === "rep") {
    if (unassigned) throw new OutreachError("FORBIDDEN", [{ path: "unassigned", code: "unassigned_not_permitted" }]);
    if (query.agent_id !== undefined && query.agent_id !== actor.agent_id)
      throw new OutreachError("FORBIDDEN", [{ path: "agent_id", code: "foreign_agent" }]);
    if (!actor.agent_id) throw new OutreachError("FORBIDDEN");
    return { kind: "agent", agent_id: actor.agent_id };
  }
  if (unassigned) return { kind: "unassigned" };
  if (query.agent_id) return { kind: "agent", agent_id: query.agent_id };
  return { kind: "all" };
}

export type NormalizedQueueQuery = Readonly<{
  match: QueueMatch;
  sort: SalesOutreachQueueSort;
  direction: "asc" | "desc";
  limit: number;
  filters: SalesOutreachQueueDto["filters"];
}>;

export function normalizeQueueQuery(actor: OutreachActor, query: SalesOutreachQueueQuery, poolEnabled = false): NormalizedQueueQuery {
  const ordinaryAssignment = queueAssignmentOf(actor, query);
  const assignment: QueueAssignment = query.queue_scope === "pool" ? { kind: "all" } : ordinaryAssignment;
  const sort = query.sort ?? "urgency";
  const direction = queueDirectionOf(sort, query.direction);
  const hasRange = Boolean(query.move_date_from || query.move_date_to);
  const unknown = query.move_date_unknown ?? (hasRange ? "exclude" : "include");
  const priority = query.priority ?? "all";
  const workflow = query.workflow ?? "all";
  const search = query.search ? query.search : null;
  const match: QueueMatch = {
    assignment,
    state: query.state ?? "needs_contact",
    priority: priority === "all" ? { kind: "all" } : priority === "unknown" ? { kind: "unknown" } : { kind: "code", code: priority },
    workflow: workflow === "all" ? null : workflow,
    ...(workflow === "other" ? { exclude_pool_priority: poolEnabled } : {}),
    move_date: hasRange || unknown !== "include" ? { from: query.move_date_from ?? null, to: query.move_date_to ?? null, unknown } : null,
    search: queueSearchOf(search ?? undefined),
  };
  return {
    match,
    sort,
    direction,
    limit: query.limit ?? SALES_OUTREACH_QUEUE_DEFAULT_LIMIT,
    filters: {
      ...(query.queue_scope ? { queue_scope: query.queue_scope } : {}),
      search,
      priority,
      workflow,
      move_date_from: query.move_date_from ?? null,
      move_date_to: query.move_date_to ?? null,
      move_date_unknown: unknown,
      agent_id: ordinaryAssignment.kind === "agent" ? ordinaryAssignment.agent_id : null,
      unassigned: ordinaryAssignment.kind === "unassigned",
      state: match.state,
    },
  };
}

function cursorSecretOf(deps: DeskQueueDeps): string {
  const secret = deps.cursorSecret === undefined ? getAdminProxySigningSecret() : deps.cursorSecret;
  if (!secret) throw new OutreachError("SERVICE_UNAVAILABLE", [{ path: "cursor", code: "signing_secret_missing" }]);
  return secret;
}

/** Drops rows whose Lead is no longer assigned to the Rep (authoritative `receiver_agent`, IMPL-01). */
async function authorizedRows(actor: OutreachActor, rows: StoredQueueRow[], store: DeskQueueStore, poolIds?: ReadonlySet<string>): Promise<StoredQueueRow[]> {
  if (actor.role !== "rep" || !rows.length) return rows;
  const assignees = await store.leadAssignees(rows.map((row) => row.subject_id));
  return rows.filter((row) => poolIds ? poolIds.has(row.subject_id) : assignees.get(row.subject_id) === actor.agent_id);
}

export async function readQueue(actor: OutreachActor, query: SalesOutreachQueueQuery, deps: DeskQueueDeps): Promise<SalesOutreachQueueDto> {
  let normalized = normalizeQueueQuery(actor, query);
  const store = deps.queueStore ?? mongoDeskQueueStore;
  const readStore = deps.store ?? mongoSalesOutreachReadStore;
  const configuration = await requireDeskConfiguration(deps.loader);
  normalized = normalizeQueueQuery(actor, query, configuration.value.pool?.enabled === true);
  const [poolWorks, freshnessRead, generation] = await Promise.all([
    authorizedPoolWorks(configuration),
    readFreshness(readStore, configuration, deps.now),
    store.assignmentGeneration(normalized.match.assignment),
  ]);
  const poolStates = await readPoolStates(poolWorks, configuration, deps.now, freshnessRead.coverage.cadence.call);
  if (poolWorks.length) normalized = { ...normalized, match: { ...normalized.match, pool_overrides: poolQueueOverrides(poolWorks, poolStates, deps.now) } };
  if (query.queue_scope === "pool") normalized = { ...normalized, match: { ...normalized.match, pool_subject_ids: poolWorks.map((p) => String(p.work.subject_id)) } };
  const cadence = requireDeskCadence(configuration);
  const secret = cursorSecretOf(deps);
  const sortSpec = queueSortSpec(normalized.sort, normalized.direction);
  const binding: CursorBinding = {
    q: queueQueryHash(JSON.parse(JSON.stringify({ match: normalized.match, sort: normalized.sort, direction: normalized.direction, ...(query.queue_scope ? { queue_scope: query.queue_scope, entitlement_version: 1 } : {}) }))),
    r: actor.role,
    a: actor.agent_id,
    g: generation,
    c: configuration.version,
    p: cadence.snapshot,
  };

  let asOf = deps.now;
  let after: readonly string[] | null = null;
  let expiresAt = +deps.now + QUEUE_CURSOR_TTL_MS;
  if (query.cursor) {
    const claims = decodeQueueCursor(query.cursor, secret);
    assertCursorCurrent(claims, binding, deps.now);
    // A New York midnight between pages changes every day-relative status: resnapshot.
    if (newYorkBusinessDay(new Date(claims.t)) !== newYorkBusinessDay(deps.now))
      throw new OutreachError("CURSOR_EXPIRED", [{ path: "cursor", code: "business_day_changed", message: "resnapshot" }]);
    asOf = new Date(claims.t);
    expiresAt = claims.e;
    after = claims.k;
  }

  const [fetched, pool_summary] = await Promise.all([
    store.findQueuePage({ match: normalized.match, sort: sortSpec, after, limit: normalized.limit + 1 }),
    configuration.value.pool?.enabled
      ? readPoolSummary(poolWorks, configuration, deps.now, freshnessRead.coverage.cadence.call, actor, query.agent_id ?? null, poolStates)
      : Promise.resolve(undefined),
  ]);
  const has_more = fetched.length > normalized.limit;
  const page = fetched.slice(0, normalized.limit);
  const visible = await authorizedRows(actor, page, store, query.queue_scope === "pool" ? new Set(poolWorks.map((w) => String(w.work.subject_id))) : undefined);

  const firstPage = !query.cursor;
  const [names, scopeCounts, excludedUnknown] = await Promise.all([
    readStore.findReviewedRepNames([...new Set(visible.map((row) => row.assigned_agent_id).filter((id): id is string => id !== null))], deps.now),
    firstPage ? query.queue_scope === "pool" ? store.countQueue({ ...normalized.match, state: "all_active", search: null, priority: { kind: "all" }, workflow: null, move_date: null }).then((projections) => ({ subjects: poolWorks.length, projections })) : store.countScope(normalized.match.assignment) : Promise.resolve(null),
    firstPage && normalized.match.move_date?.unknown === "exclude" && (normalized.filters.move_date_from || normalized.filters.move_date_to)
      ? store.countQueue({ ...normalized.match, move_date: { from: null, to: null, unknown: "only" } })
      : Promise.resolve(null),
  ]);

  const last = page.at(-1);
  const next_cursor =
    has_more && last
      ? encodeQueueCursor({ v: QUEUE_CURSOR_VERSION, ...binding, t: +asOf, e: expiresAt, k: keysetOf(sortSpec, last) }, secret)
      : null;
  const today = newYorkBusinessDay(asOf);
  const projection_revision = visible.reduce<number | null>((max, row) => Math.max(max ?? 0, row.publication_revision), null);
  const scopedAgent = normalized.match.assignment.kind === "agent" ? normalized.match.assignment.agent_id : null;
  const callerIds = [...new Set([...poolStates.values()].flatMap((s) => s.completed_by_agent_id ? [s.completed_by_agent_id] : []))];
  const callerNames = callerIds.length ? await readStore.findAgentNames(callerIds) : new Map<string, string>();
  const displayNames = new Map(names);
  const missingAssignedNames = [...new Set(visible.flatMap((row) => row.assigned_agent_id && !displayNames.has(row.assigned_agent_id) ? [row.assigned_agent_id] : []))];
  if (missingAssignedNames.length) for (const [id, name] of await readStore.findAgentNames(missingAssignedNames)) displayNames.set(id, name);
  for (const state of poolStates.values()) if (state.completed_by_agent_id) state.completed_by_agent_name = callerNames.get(state.completed_by_agent_id) ?? state.completed_by_agent_name;
  const rows = await Promise.all(visible.map(async (row) => {
    const presented = presentQueueRow(row, { as_of: asOf, today, names: displayNames, exposure: cadence.exposure, coverage: freshnessRead.coverage });
    const access = poolWorks.find((w) => String(w.work.subject_id) === row.subject_id);
    if (!access) return presented;
    const pool = poolStates.get(row.subject_id)!;
    return { ...presented, pool };
  }));
  return {
    ...commonRead(actor, asOf, scopedAgent, configuration, projection_revision, freshnessRead.freshness),
    filters: normalized.filters,
    sort: normalized.sort,
    direction: normalized.direction,
    limit: normalized.limit,
    cadence_exposure: cadence.exposure,
    enforcement_labels: cadence.exposure === "enforcement",
    rows,
    ...(pool_summary ? { pool_summary } : {}),
    next_cursor,
    has_more,
    counts: {
      projection_pending: scopeCounts ? Math.max(0, scopeCounts.subjects - scopeCounts.projections) : null,
      excluded_unknown_move_date: excludedUnknown,
    },
  };
}
