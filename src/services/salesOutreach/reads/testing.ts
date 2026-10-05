import {
  salesOutreachConfigurationValueSchema,
  type SalesOutreachConfigurationInput,
} from "../../../validation/v1/salesOutreach";
import type { ConfigurationInspection, ConfigurationLoader } from "../config/load";
import { OutreachError } from "../errors";
import type { CaptureSyncRow } from "./freshness";
import type { RepDayRow } from "./goals";
import type { SalesOutreachReadStore } from "./store";

/**
 * Unit-test stand-ins for the desk reads (no Mongo): a fixed configuration loader and an in-memory
 * read store that records the queries it served.
 */
export function fixedConfigurationLoader(inspection: ConfigurationInspection): ConfigurationLoader {
  return {
    inspect: async () => inspection,
    load: async () => {
      if (inspection.state === "unavailable") throw new OutreachError("CONFIGURATION_UNAVAILABLE");
      return inspection;
    },
    requireActive: async () => {
      if (inspection.state !== "active") throw new OutreachError("CONFIGURATION_UNAVAILABLE");
      return inspection;
    },
  };
}

/** An active configuration inspection for `input` (validated with the strict value schema). */
export function activeInspection(input: SalesOutreachConfigurationInput, version = "v-test", revision = 3): ConfigurationInspection {
  return {
    state: "active",
    version,
    revision,
    content_hash: `hash-${version}`,
    approval_ref: null,
    value: salesOutreachConfigurationValueSchema.parse(input),
    updated_at: null,
    updated_by: null,
  };
}

export class MemoryReadStore implements SalesOutreachReadStore {
  rows: RepDayRow[] = [];
  names = new Map<string, string>();
  calls: CaptureSyncRow | null = null;
  mailboxes: CaptureSyncRow[] = [];
  granot: Date | null = null;
  queries: Array<{ business_day: string; agent_ids: readonly string[] | null }> = [];

  async findRepDayRows(businessDay: string, agentIds: readonly string[] | null) {
    this.queries.push({ business_day: businessDay, agent_ids: agentIds });
    return this.rows.filter((row) => row.business_day === businessDay && (!agentIds || agentIds.includes(row.agent_id)));
  }
  async findReviewedRepNames(agentIds: readonly string[]) {
    return new Map([...this.names].filter(([id]) => agentIds.includes(id)));
  }
  async readCallsCapture() {
    return this.calls;
  }
  async readSmsMailboxes() {
    return this.mailboxes;
  }
  async readLatestGranotObservationAt() {
    return this.granot;
  }
}

/** A rep-day row with M1 defaults (all-outbound scope, no snapshot, no coverage of its own). */
export function repDayRow(input: Partial<RepDayRow> & Pick<RepDayRow, "agent_id" | "business_day">): RepDayRow {
  return {
    count_scope: "all_outbound",
    goal_snapshot: null,
    actual_confirmed: 0,
    actual_awaiting_confirmation: 0,
    unattributed: 0,
    coverage: null,
    computed_as_of: null,
    publication_revision: 1,
    ...input,
  };
}
