import type { MemoryContactEventStore } from "./testing";
import type { RepDayStore, StoredRepDay } from "./repDayService";
import type { CoverageWatermarks, RepDayRowFields } from "./repDay";
import type { SweepCursor, SweepKind, SweepState, SweepStore } from "./sweep";

/** Unit-test stand-ins for the rep-day projection and the minute sweep (no Mongo). */

export class MemoryRepDayStore implements RepDayStore {
  rows = new Map<string, RepDayRowFields & { publication_revision: number; revision: number; computed_as_of: Date }>();
  marks: CoverageWatermarks = { capture_known_complete_through: null, derived_through: null, coverage_from: null };
  constructor(private readonly source: MemoryContactEventStore) {}

  async events(key: { agent_id: string; business_day: string }) {
    return [...this.source.events.values()]
      .filter((e) => e.goal_agent_id === key.agent_id && e.business_date === key.business_day)
      .map((e) => ({ source_id: e.source_id, goal_credit: e.goal_credit, goal_scope_eligible: e.goal_scope_eligible }));
  }
  async readRow(key: { agent_id: string; business_day: string }): Promise<StoredRepDay | null> {
    const row = this.rows.get(`${key.agent_id}|${key.business_day}`);
    return row
      ? {
          goal_snapshot: row.goal_snapshot,
          input_fingerprint: row.input_fingerprint,
          publication_revision: row.publication_revision,
          revision: row.revision,
          coverage_state: row.coverage.state,
          count_scope: row.count_scope,
        }
      : null;
  }
  async writeRow(fields: RepDayRowFields, previous: StoredRepDay | null, now: Date) {
    const publication = (previous?.publication_revision ?? 0) + 1;
    this.rows.set(`${fields.agent_id}|${fields.business_day}`, { ...fields, publication_revision: publication, revision: (previous?.revision ?? 0) + 1, computed_as_of: now });
    return publication;
  }
  async watermarks() {
    return this.marks;
  }
  async rowsOfDay(day: string) {
    return [...this.rows.values()]
      .filter((row) => row.business_day === day)
      .map((row) => ({
        agent_id: row.agent_id,
        coverage_state: row.coverage.state,
        frozen: Boolean(row.goal_snapshot.configuration_version),
        count_scope: row.count_scope,
      }));
  }
  row(agent: string, day: string) {
    return this.rows.get(`${agent}|${day}`) ?? null;
  }
}

export class MemorySweepStore implements SweepStore {
  state = new Map<SweepKind, { cursor: SweepCursor | null; coverage_from: Date | null; known_complete_through: Date | null }>();
  sources = new Map<SweepKind, Array<{ id: string; updated_at: Date }>>();
  capture: Date | null = null;

  async readState(kind: SweepKind): Promise<SweepState> {
    const row = this.state.get(kind);
    return { cursor: row?.cursor ?? null, coverage_from: row?.coverage_from ?? null };
  }
  async writeState(kind: SweepKind, update: { cursor: SweepCursor; coverage_from?: Date; known_complete_through?: Date | null }) {
    const row = this.state.get(kind) ?? { cursor: null, coverage_from: null, known_complete_through: null };
    this.state.set(kind, {
      cursor: update.cursor,
      coverage_from: update.coverage_from ?? row.coverage_from,
      known_complete_through: update.known_complete_through ?? row.known_complete_through,
    });
  }
  private ordered(kind: SweepKind) {
    return [...(this.sources.get(kind) ?? [])].sort((a, b) => a.updated_at.getTime() - b.updated_at.getTime() || a.id.localeCompare(b.id));
  }
  async sourcesAfter(kind: SweepKind, cursor: SweepCursor, limit: number) {
    return this.ordered(kind)
      .filter((row) => row.updated_at > cursor.updated_at || (row.updated_at.getTime() === cursor.updated_at.getTime() && row.id > cursor.id))
      .slice(0, limit);
  }
  async sourcesInOverlap(kind: SweepKind, cursor: SweepCursor, overlapMs: number, limit: number) {
    return this.ordered(kind)
      .filter((row) => row.updated_at.getTime() > cursor.updated_at.getTime() - overlapMs && row.updated_at <= cursor.updated_at)
      .slice(0, limit)
      .map((row) => row.id);
  }
  async captureKnownCompleteThrough() {
    return this.capture;
  }
}

