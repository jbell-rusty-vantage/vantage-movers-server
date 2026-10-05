/**
 * Bounded catch-up (P06a): routine windows that close unmet coalesce into at most one actionable
 * catch-up per channel per policy period, keeping the oldest missed deadline. The next qualifying contact
 * of that channel (any hour, P07g) clears it; that same event may also satisfy one ordinary requirement.
 * Clearing never adds goal credit, never shifts the fixed SMS sequence, and Call never clears SMS.
 * A priority change or closure ends the period's catch-up (superseded, never revived).
 */
import type { WorkingObligation } from "./obligation";
import type { Channel } from "./types";

export interface CatchUpGroup {
  period_id: string;
  channel: Channel;
  createdAt: number;
  members: WorkingObligation[];
  clearedAt: number | null;
  clearedBy: string | null;
  /** Period end (superseded) — no longer actionable. */
  endedAt: number | null;
}

export class CatchUpLedger {
  readonly groups: CatchUpGroup[] = [];

  private open(periodId: string, channel: Channel): CatchUpGroup | undefined {
    return this.groups.find((g) => g.period_id === periodId && g.channel === channel && g.clearedAt === null && g.endedAt === null);
  }

  /** A routine obligation closed unmet at `closedAt`. */
  addMiss(ob: WorkingObligation, closedAt: number): void {
    const group = this.open(ob.period_id, ob.channel);
    if (group) {
      group.members.push(ob);
      return;
    }
    this.groups.push({ period_id: ob.period_id, channel: ob.channel, createdAt: closedAt, members: [ob], clearedAt: null, clearedBy: null, endedAt: null });
  }

  /** Clear the outstanding catch-up of the event's active period/channel. Returns true when cleared. */
  clear(periodId: string, channel: Channel, at: number, eventId: string): boolean {
    const group = this.open(periodId, channel);
    if (!group || group.createdAt > at) return false;
    group.clearedAt = at;
    group.clearedBy = eventId;
    return true;
  }

  endPeriod(periodId: string, at: number): void {
    for (const g of this.groups) if (g.period_id === periodId && g.clearedAt === null && g.endedAt === null && g.createdAt <= at) g.endedAt = at;
  }

  outstanding(channel: Channel): CatchUpGroup | null {
    return this.groups.find((g) => g.channel === channel && g.clearedAt === null && g.endedAt === null) ?? null;
  }
}
