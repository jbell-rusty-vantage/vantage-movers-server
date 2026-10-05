/**
 * Regenerate the Sales Outreach Desk M1 read examples the admin team builds against:
 *
 *   node --import tsx ops/sales-outreach/write-dto-examples.ts
 *
 * Writes `docs/sales-outreach-desk/workspace/evidence/dto-examples/*.json` from the real read
 * services over a synthetic in-memory store (no database, no provider, no env). The roster mirrors
 * contracts/fixtures/p08a-roster-goals.json (partial-day and absence overrides, 108/100) plus one
 * rep with no activity yet and one Agent with calls who is not on the roster.
 * `src/routes/sales-outreach.reads.routes.test.ts` parses every file with the exported DTO schemas.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { OutreachActor } from "../../src/services/salesOutreach/auth";
import { OutreachError } from "../../src/services/salesOutreach/errors";
import { readDeskCapabilities, readRepDays, readTeam, type DeskReadDeps } from "../../src/services/salesOutreach/reads/service";
import { activeInspection, fixedConfigurationLoader, MemoryReadStore, repDayRow } from "../../src/services/salesOutreach/reads/testing";
import { csiOperatorActor } from "../../src/services/salesIntelligence/auth";
import type { SalesOutreachConfigurationInput } from "../../src/validation/v1/salesOutreach";

export const DTO_EXAMPLES_DIR = path.resolve(__dirname, "../../docs/sales-outreach-desk/workspace/evidence/dto-examples");

const NOW = new Date("2026-10-05T15:00:00.000Z");
const DAY = "2026-10-05";
const [A, B, C, D, E, X] = ["a", "b", "c", "d", "e", "f"].map((suffix) => `6650a1b2c3d4e5f60718293${suffix}`) as [string, string, string, string, string, string];

const desk: SalesOutreachConfigurationInput = {
  controls: { desk_enabled: true, goal_metrics_enabled: true },
  goals: {
    roster_version: "m1-roster-2026-10-05",
    default_scheduled_goal: 100,
    zero_goal_rule: "no_goal_today_excluded_from_denominator",
    rep_work_schedules: [A, B, C, D, E].map((agent_id) => ({ agent_id, working_days: [1, 2, 3, 4, 5, 6, 7] })),
    effective_day_overrides: [
      { agent_id: D, business_date: DAY, goal: 50, reason: "partial_day" },
      { agent_id: E, business_date: DAY, goal: 0, reason: "absence" },
    ],
  },
};

function exampleStore(): MemoryReadStore {
  const store = new MemoryReadStore();
  const computed = new Date("2026-10-05T14:58:30Z");
  store.rows = [
    repDayRow({ agent_id: A, business_day: DAY, actual_confirmed: 108, actual_awaiting_confirmation: 2, computed_as_of: computed, publication_revision: 41 }),
    repDayRow({ agent_id: C, business_day: DAY, actual_confirmed: 37, computed_as_of: computed, publication_revision: 39 }),
    repDayRow({ agent_id: D, business_day: DAY, actual_confirmed: 25, computed_as_of: computed, publication_revision: 40 }),
    repDayRow({ agent_id: E, business_day: DAY, actual_confirmed: 10, computed_as_of: computed, publication_revision: 33 }),
    repDayRow({ agent_id: X, business_day: DAY, actual_confirmed: 4, computed_as_of: computed, publication_revision: 12 }),
  ];
  store.names = new Map([
    [A, "Alice Rep"],
    [B, "Bob Rep"],
    [C, "Cara Rep"],
    [D, "Dan Rep"],
    [E, "Eve Rep"],
  ]);
  store.calls = {
    scope: "call_log_all_directions",
    known_complete_through: new Date("2026-10-05T14:57:00Z"),
    last_finished_at: new Date("2026-10-05T14:57:40Z"),
    last_error_code: null,
  };
  store.granot = new Date("2026-10-05T14:56:10Z");
  return store;
}

const actor = (role: OutreachActor["role"], agent_id: string | null = null): OutreachActor => ({ role, actor: csiOperatorActor("dto-example"), agent_id });

/** Every example file name with its payload. */
export async function buildDtoExamples(): Promise<Record<string, unknown>> {
  const store = exampleStore();
  const deps = (input: SalesOutreachConfigurationInput, version: string, revision: number): DeskReadDeps => ({
    loader: fixedConfigurationLoader(activeInspection(input, version, revision)),
    store,
    now: NOW,
  });
  const live = deps(desk, "sod-cfg-7f3a", 4);
  const ok = (data: unknown) => ({ ok: true, data });
  const refusal = (error: OutreachError) => ({
    ok: false,
    code: error.code,
    error: "Sales Outreach request rejected",
    request_id: "req-example",
    ...(error.issues?.length ? { issues: error.issues } : {}),
  });
  const owner = actor("owner");
  const manager = actor("manager");
  const rep = actor("rep", A);
  return {
    "capabilities.owner.json": ok(await readDeskCapabilities(owner, live)),
    "capabilities.manager.json": ok(await readDeskCapabilities(manager, live)),
    "capabilities.rep.json": ok(await readDeskCapabilities(rep, live)),
    "capabilities.owner.desk-disabled.json": ok(
      await readDeskCapabilities(owner, deps({ ...desk, controls: { desk_enabled: false, goal_metrics_enabled: true } }, "sod-cfg-8b21", 5)),
    ),
    "rep-days.owner.json": ok(await readRepDays(owner, {}, live)),
    "rep-days.rep.json": ok(await readRepDays(rep, {}, live)),
    "rep-days.goal-metrics-disabled.json": ok(await readRepDays(rep, {}, deps({ controls: { desk_enabled: true } }, "sod-cfg-1c09", 2))),
    "team.owner.json": ok(await readTeam(owner, {}, live)),
    "team.manager.json": ok(await readTeam(manager, {}, live)),
    "error.configuration-unavailable.desk-disabled.json": refusal(
      new OutreachError("CONFIGURATION_UNAVAILABLE", [{ path: "controls.desk_enabled", code: "desk_disabled" }]),
    ),
    "error.rep-foreign-agent.json": refusal(new OutreachError("FORBIDDEN", [{ path: "agent_id", code: "foreign_agent" }])),
  };
}

async function main() {
  mkdirSync(DTO_EXAMPLES_DIR, { recursive: true });
  for (const [name, body] of Object.entries(await buildDtoExamples()))
    writeFileSync(path.join(DTO_EXAMPLES_DIR, name), `${JSON.stringify(body, null, 2)}\n`);
  console.log(`wrote ${DTO_EXAMPLES_DIR}`);
}

if (require.main === module) void main();
