/**
 * Regenerate the Sales Outreach Desk SRV-7 command examples the admin team builds against:
 *
 *   node --import tsx ops/sales-outreach/write-command-dto-examples.ts
 *
 * Writes `docs/sales-outreach-desk/workspace/evidence/dto-examples/commands/*.json`, each
 * `{ request, response }`, from the real command services over the in-memory command store, CSI
 * ledger stand-in and configuration store (no database, no provider, no env). The sequence is one
 * synthetic Quoted subject assigned to Alice: Rep Quoted date → reschedule → stale 409 → callback
 * replacement refused without intent → Manager callback with intent → Rep reschedule → Owner cancel
 * → foreign Rep 404 → Manager reassign → Owner unassign → day overrides → restriction review.
 * `src/routes/sales-outreach.commands.routes.test.ts` parses every file with the exported DTO schemas.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { OutreachActor } from "../../src/services/salesOutreach/auth";
import { assignSubject } from "../../src/services/salesOutreach/commands/assignment";
import { setGoalDayOverride } from "../../src/services/salesOutreach/commands/dayOverride";
import { commandCallback, setQuotedFollowup } from "../../src/services/salesOutreach/commands/plans";
import { addRestriction, confirmRestriction, liftRestriction, listRestrictions } from "../../src/services/salesOutreach/commands/restrictions";
import { MemoryCommandLedger, MemoryDeskCommandStore } from "../../src/services/salesOutreach/commands/testing";
import { patchSalesOutreachConfiguration } from "../../src/services/salesOutreach/config/commands";
import { createConfigurationLoader } from "../../src/services/salesOutreach/config/load";
import { MemoryConfigurationDb } from "../../src/services/salesOutreach/config/testing";
import { toOutreachError } from "../../src/services/salesOutreach/errors";
import { completeConfigurationInput, periodRow, subjectRow } from "../../src/services/salesOutreach/evaluation/testing";
import { csiOperatorActor, type CsiActor } from "../../src/services/salesIntelligence/auth";
import { DTO_EXAMPLES_DIR } from "./write-dto-examples";

export const COMMAND_DTO_EXAMPLES_DIR = path.join(DTO_EXAMPLES_DIR, "commands");

const API = "/api/v1/admin/sales-outreach";
const [A, B] = ["a", "b"].map((suffix) => `6650a1b2c3d4e5f60718293${suffix}`) as [string, string];
const SUBJECT = "6650a1b2c3d4e5f607182a01";
const PERIOD = "6650a1b2c3d4e5f607182b01";
const LEAD = "6650a1b2c3d4e5f607182c01";
const NUMBER = "6650a1b2c3d4e5f607182d01";
/** Another customer's Contact Number carrying one of the inert AI-origin restrictions. */
const OTHER_NUMBER = "6650a1b2c3d4e5f607182d02";
const AI_RESTRICTION = "6650a1b2c3d4e5f607182e01";

const commandActor = (role: OutreachActor["role"], id: string, agentId: string | null = null): OutreachActor => ({
  role,
  actor: { ...csiOperatorActor(`dto-example-${id}`), kind: role, id } as CsiActor,
  agent_id: agentId,
});

/** The persisted configuration the examples run against (complete FINAL-01 cadence, desk on, roster A and B). */
function exampleConfiguration() {
  const value = completeConfigurationInput();
  return { ...value, goals: { ...value.goals, rep_work_schedules: [A, B].map((agent_id) => ({ agent_id, working_days: [1, 2, 3, 4, 5, 6, 7], scheduled_goal: null })) } };
}

async function exampleWorld() {
  const store = new MemoryDeskCommandStore();
  const ledger = new MemoryCommandLedger([store]);
  // Monday 2026-10-05 12:00 New York.
  ledger.now = new Date("2026-10-05T16:00:00.000Z");
  store.subjects.set(SUBJECT, {
    ...subjectRow({ id: SUBJECT, lead: { model: "FormLead", id: LEAD }, assigned_agent_id: A, assignment_revision: 1, contact_number_ids: [NUMBER], lead_revision_seen: 4 }),
    received_at: new Date("2026-10-01T14:00:00.000Z"),
    received_date: "2026-10-01",
  });
  store.periods.push(
    periodRow(SUBJECT, { id: PERIOD, workflow: "quoted", start_kind: "transition", priority: "1", transition_key: "priority:example:quoted:1", started_at: new Date("2026-10-02T14:00:00.000Z") }),
  );
  store.leads.set(`FormLead:${LEAD}`, { receiver_agent_id: A, receiver_agent_source: "granot_username_match", domain_revision: 4, name: "Alice Rep", source_value: null, set_at: null });
  store.repNames = new Map([
    [A, "Alice Rep"],
    [B, "Bob Rep"],
  ]);
  store.numbers.add(NUMBER);
  store.restrictions.push({
    id: AI_RESTRICTION,
    contact_number_id: OTHER_NUMBER,
    channels: ["call", "text"],
    until: null,
    origin: "intelligence",
    state: "active",
    created_at: new Date("2026-09-20T12:00:00.000Z"),
    updated_at: null,
    reason: null,
    confirmed_at: null,
    confirmed_by: null,
    resolved_at: null,
    resolved_by: null,
    resolution_reason: null,
    revision: 1,
    actor: null,
  });
  const configuration = new MemoryConfigurationDb();
  await patchSalesOutreachConfiguration(
    { actor: csiOperatorActor("dto-example"), idempotency_key: "install", expected_revision: 0, value: exampleConfiguration() },
    configuration.deps(),
  );
  const deps = {
    loader: createConfigurationLoader(configuration.store),
    store,
    run: ledger.run,
    audit: ledger.audit,
    publish: async () => undefined,
    configStore: configuration.store,
    writer: configuration.writer,
  };
  return { ledger, deps };
}

const request = (method: string, route: string, key: string | null, body: unknown) => ({
  method,
  path: `${API}${route}`,
  headers: key ? { "Idempotency-Key": key } : {},
  ...(body === undefined ? {} : { body }),
});
const accepted = (method: string, route: string, key: string | null, body: unknown, data: unknown) => ({ request: request(method, route, key, body), response: { ok: true, data } });

async function refused(method: string, route: string, key: string, body: unknown, run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    const known = toOutreachError(error);
    if (!known) throw error;
    return {
      request: request(method, route, key, body),
      response: { ok: false, code: known.code, error: "Sales Outreach request rejected", request_id: "req-example", ...(known.issues?.length ? { issues: known.issues } : {}) },
    };
  }
  throw new Error(`expected a refusal for ${method} ${route}`);
}

/** Every example file name with its `{ request, response }` payload. */
export async function buildCommandDtoExamples(): Promise<Record<string, unknown>> {
  const { ledger, deps } = await exampleWorld();
  const owner = commandActor("owner", "admin-owner-1");
  const manager = commandActor("manager", "admin-manager-1");
  const rep = commandActor("rep", "admin-rep-a", A);
  const out: Record<string, unknown> = {};
  const quoted = `/outreach/${SUBJECT}/quoted-followup`;
  const callback = `/outreach/${SUBJECT}/callback`;
  const assignment = `/outreach/${SUBJECT}/assignment`;

  const q1 = { expected_revision: 0, period_id: PERIOD, selected_date: "2026-10-07" };
  out["quoted-followup.rep.json"] = accepted("PATCH", quoted, "rep-a-quoted-1", q1, await setQuotedFollowup({ actor: rep, subject_id: SUBJECT, idempotency_key: "rep-a-quoted-1", replace_active_plan: false, ...q1 }, deps));
  const q2 = { expected_revision: 1, period_id: PERIOD, selected_date: "2026-10-08" };
  out["quoted-followup.reschedule.json"] = accepted("PATCH", quoted, "rep-a-quoted-2", q2, await setQuotedFollowup({ actor: rep, subject_id: SUBJECT, idempotency_key: "rep-a-quoted-2", replace_active_plan: false, ...q2 }, deps));
  const q3 = { expected_revision: 1, period_id: PERIOD, selected_date: "2026-10-09" };
  out["error.revision-conflict.json"] = await refused("PATCH", quoted, "rep-a-quoted-3", q3, () =>
    setQuotedFollowup({ actor: rep, subject_id: SUBJECT, idempotency_key: "rep-a-quoted-3", replace_active_plan: false, ...q3 }, deps),
  );
  const c0 = { operation: "set" as const, expected_revision: 2, appointment_at: "2026-10-08T19:00:00.000Z" };
  out["error.replacement-intent-required.json"] = await refused("PATCH", callback, "mgr-callback-0", c0, () =>
    commandCallback({ actor: manager, subject_id: SUBJECT, idempotency_key: "mgr-callback-0", replace_active_plan: false, ...c0 }, deps),
  );
  const c1 = { ...c0, replace_active_plan: true };
  out["callback.set.json"] = accepted("PATCH", callback, "mgr-callback-1", c1, await commandCallback({ actor: manager, subject_id: SUBJECT, idempotency_key: "mgr-callback-1", ...c1 }, deps));
  const c2 = { operation: "reschedule" as const, expected_revision: 3, appointment_at: "2026-10-08T20:30:00.000Z" };
  out["callback.reschedule.json"] = accepted("PATCH", callback, "rep-a-callback-2", c2, await commandCallback({ actor: rep, subject_id: SUBJECT, idempotency_key: "rep-a-callback-2", ...c2 }, deps));
  const c3 = { operation: "cancel" as const, expected_revision: 4 };
  out["callback.cancel.json"] = accepted("PATCH", callback, "owner-callback-3", c3, await commandCallback({ actor: owner, subject_id: SUBJECT, idempotency_key: "owner-callback-3", ...c3 }, deps));
  const foreign = { expected_revision: 5, period_id: PERIOD, selected_date: "2026-10-07" };
  out["error.not-found.foreign-rep.json"] = await refused("PATCH", quoted, "rep-b-quoted-1", foreign, () =>
    setQuotedFollowup({ actor: commandActor("rep", "admin-rep-b", B), subject_id: SUBJECT, idempotency_key: "rep-b-quoted-1", replace_active_plan: false, ...foreign }, deps),
  );

  out["assignment.manager.json"] = accepted("PATCH", assignment, "mgr-assign-1", { expected_revision: 1, agent_id: B }, await assignSubject({ actor: manager, subject_id: SUBJECT, idempotency_key: "mgr-assign-1", expected_revision: 1, agent_id: B }, deps));
  out["assignment.unassign.json"] = accepted("PATCH", assignment, "owner-assign-2", { expected_revision: 2, agent_id: null }, await assignSubject({ actor: owner, subject_id: SUBJECT, idempotency_key: "owner-assign-2", expected_revision: 2, agent_id: null }, deps));

  const d1 = { expected_revision: 1, business_date: "2026-10-05", goal: 0, reason: "absence" as const };
  out["day-override.manager-absence.json"] = accepted("PATCH", `/goals/${B}/day-override`, "mgr-override-1", d1, await setGoalDayOverride({ actor: manager, agent_id: B, idempotency_key: "mgr-override-1", ...d1 }, deps));
  const d2 = { expected_revision: 2, business_date: "2026-10-02", goal: 60, reason: "partial_day" as const };
  out["day-override.owner-historical-partial-day.json"] = accepted("PATCH", `/goals/${A}/day-override`, "owner-override-2", d2, await setGoalDayOverride({ actor: owner, agent_id: A, idempotency_key: "owner-override-2", ...d2 }, deps));
  const d3 = { expected_revision: 3, business_date: "2026-10-02", goal: 0, reason: "absence" as const };
  out["error.historical-edit-owner-only.json"] = await refused("PATCH", `/goals/${B}/day-override`, "mgr-override-3", d3, () =>
    setGoalDayOverride({ actor: manager, agent_id: B, idempotency_key: "mgr-override-3", ...d3 }, deps),
  );

  out["restrictions.list.json"] = accepted("GET", "/restrictions?state=active&limit=25", null, undefined, await listRestrictions(owner, { state: "active", limit: 25 }, { ...deps, now: ledger.now }));
  out["restrictions.confirm.json"] = accepted("POST", `/restrictions/${AI_RESTRICTION}/confirm`, "owner-confirm-1", { expected_revision: 1 }, await confirmRestriction({ actor: owner, idempotency_key: "owner-confirm-1", restriction_id: AI_RESTRICTION, expected_revision: 1 }, deps));
  const lift = { expected_revision: 2, reason: "Customer asked to be called again" };
  out["restrictions.lift.json"] = accepted("POST", `/restrictions/${AI_RESTRICTION}/lift`, "owner-lift-1", lift, await liftRestriction({ actor: owner, idempotency_key: "owner-lift-1", restriction_id: AI_RESTRICTION, ...lift }, deps));
  const add = { contact_number_id: NUMBER, channels: ["sms" as const], until: "2026-10-12T04:00:00.000Z", reason: "Customer asked for no texts this week" };
  out["restrictions.add.json"] = accepted("POST", "/restrictions", "owner-restrict-1", add, await addRestriction({ actor: owner, idempotency_key: "owner-restrict-1", ...add }, deps));
  return out;
}

async function main() {
  mkdirSync(COMMAND_DTO_EXAMPLES_DIR, { recursive: true });
  for (const [name, body] of Object.entries(await buildCommandDtoExamples()))
    writeFileSync(path.join(COMMAND_DTO_EXAMPLES_DIR, name), `${JSON.stringify(body, null, 2)}\n`);
  console.log(`wrote ${COMMAND_DTO_EXAMPLES_DIR}`);
}

if (require.main === module) void main();
