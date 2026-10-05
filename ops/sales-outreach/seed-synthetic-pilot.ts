/**
 * Seed a synthetic Sales Outreach Desk pilot on the local csi01 loopback replica (SPRINT-RUNBOOK P2
 * step 2). Test databases only; never production.
 *
 *   pnpm outreach:seed-pilot --database=testvantagemovers_sodpilot [--as-of=<ISO instant>] [--reset]
 *
 * Writes, relative to `--as-of` (default now) in New York dates:
 * - 3 Agents + one reviewed `sales_rep` identity link each (rc_account_id "pilot", extensions 101–103);
 * - 22 Form Leads (`form_leads`, raw rows in the live ingestion shape: ET wall-clock `timestamp`,
 *   `createdAt` 3 s after the instant, `domain_revision` 1, an accepted Granot observation) covering New
 *   Day 1/3/4/6, Quoted with and without a selected date, Unassigned, Priority 3, an unmapped priority, a
 *   restricted number, a shared phone, a missing Job Number and one Lead outside the 90-day backfill scope;
 * - one Contact Number per distinct phone, linked (All Numbers `lead` / `other_leads`) to its Leads;
 * - one active, unconfirmed `intelligence`-origin contact restriction on the restricted Lead's number.
 *
 * Refuses: a missing or non-`testvantagemovers_<alnum>` database, a non-loopback URI, a connection whose
 * database differs from the one requested, and existing rows in any seeded collection unless `--reset`
 * (which drops only those collections in the requested test database).
 *
 * Does not: install configuration, build indexes, enroll, or write admin users, jobs, subjects or
 * projections. Ids are deterministic (sha256 of a stable key), so a `--reset` re-run yields the same ids.
 * It prints the admin-repo `seed:admin` invocations (Owner, Manager, one Rep per Agent) and the next
 * runbook steps. Env is scrubbed exactly like the replica proofs; `.env` is never read.
 */
import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { csiEnqueueReplicaTarget } from "../lib/csi-enqueue-replica-target";

type Args = { database: string; asOf: Date; reset: boolean };

const DATABASE_RULE = /^testvantagemovers_[a-z0-9]+$/;
const LOOPBACK_RULE = /^mongodb:\/\/127\.0\.0\.1(?::\d+)?\//;

function refuse(message: string): never {
  console.error(`Refusing: ${message}`);
  process.exit(1);
}

function parseArgs(argv: readonly string[]): Args {
  let database: string | null = null;
  let asOf = new Date();
  let reset = false;
  for (const arg of argv) {
    if (arg.startsWith("--database=")) database = arg.slice("--database=".length).trim();
    else if (arg.startsWith("--as-of=")) {
      asOf = new Date(arg.slice("--as-of=".length).trim());
      if (!Number.isFinite(+asOf)) refuse(`--as-of must be an ISO instant, not "${arg}"`);
    } else if (arg === "--reset") reset = true;
    else refuse(`unknown argument ${arg}`);
  }
  if (!database) refuse("--database=<testvantagemovers_suffix> is required");
  if (!DATABASE_RULE.test(database)) refuse(`--database=${database} does not match ${DATABASE_RULE} (test databases only)`);
  return { database, asOf, reset };
}

const args = parseArgs(process.argv.slice(2));

// Same preamble as ops/sales-outreach/*.replica.ts: no provider or production env can leak in.
for (const key of Object.keys(process.env))
  if (/RINGCENTRAL|^RC_|BLOB|GATEWAY|OPENAI|ANTHROPIC|VERCEL|KV_REST|REDIS|UPSTASH|QSTASH|GOOGLE|MONGO|DOTENV/i.test(key)) delete process.env[key];
process.env.DOTENV_CONFIG_PATH = `${__dirname}/.sod-pilot-seed-no-dotenv.env`;
// The helper refuses any argument of its own; this script's flags are parsed and checked above.
process.env.MONGO_URI = csiEnqueueReplicaTarget(process.argv.slice(0, 2));
if (!LOOPBACK_RULE.test(process.env.MONGO_URI)) refuse(`resolved URI is not loopback: ${process.env.MONGO_URI}`);
process.env.TEST_MODE = "true";
process.env.TEST_MONGO_DATABASE_NAME = args.database;
process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID = "sod-pilot-seed";
process.env.SHEET_SYNC_MODE = "disabled";

const SEEDED_COLLECTIONS = [
  "agents",
  "rep_identity_links",
  "form_leads",
  "contact_numbers",
  "sales_intelligence_contact_restrictions",
] as const;

/** Stable ObjectId: the first 24 hex characters of sha256("sod-pilot:" + key). */
const oid = (key: string) => new mongoose.Types.ObjectId(createHash("sha256").update(`sod-pilot:${key}`).digest("hex").slice(0, 24));
const pad = (n: number) => String(n).padStart(2, "0");

type NyDate = { y: number; m: number; d: number };
const isoDate = ({ y, m, d }: NyDate) => `${y}-${pad(m)}-${pad(d)}`;
const shiftDays = ({ y, m, d }: NyDate, delta: number): NyDate => {
  const t = new Date(Date.UTC(y, m - 1, d + delta));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};
const utcMidnight = (date: NyDate) => new Date(`${isoDate(date)}T00:00:00.000Z`);

type LeadCase =
  | "new_day1"
  | "new_day3"
  | "new_day4"
  | "new_day6"
  | "quoted_selected_date_pending"
  | "quoted_no_selected_date"
  | "unassigned_new"
  | "unassigned_quoted"
  | "priority_3_discretion"
  | "unmapped_priority_9"
  | "restricted_number"
  | "shared_phone"
  | "missing_job_number"
  | "not_enrolled_older";

const CASE_LABELS: Record<LeadCase, string> = {
  new_day1: "New, received today (Day 1)",
  new_day3: "New, received 2 days ago (Day 3)",
  new_day4: "New, received 3 days ago (Day 4)",
  new_day6: "New, received 5 days ago (Day 6)",
  quoted_selected_date_pending: "Quoted (priority 1): selected date to be set via PATCH outreach/:id/quoted-followup during the walk",
  quoted_no_selected_date: "Quoted (priority 1): no selected date",
  unassigned_new: "Unassigned (no receiver_agent), New",
  unassigned_quoted: "Unassigned (no receiver_agent), Quoted",
  priority_3_discretion: "Priority 3 (discretion, no routine cadence)",
  unmapped_priority_9: "Unmapped accepted priority 9 (workflow none: No policy configured)",
  restricted_number: "New on a number with an active, unconfirmed intelligence-origin restriction (needs review)",
  shared_phone: "Shared phone: two Leads, one Contact Number linked to both (the newest is its Lead)",
  missing_job_number: "New with no Job Number",
  not_enrolled_older: "Received 100 days ago with a past move date (outside the 90-day backfill scope: Not enrolled - older)",
};

/** Agent index 0..2, or null for an Unassigned Lead. */
type LeadSpec = { key: string; case: LeadCase; daysAgo: number; hh: number; mm: number; agent: number | null; priority: string; moveInDays: number; jobNo: boolean; phoneSlot: number };

const LEAD_SPECS: LeadSpec[] = [
  { key: "new-day1-a", case: "new_day1", daysAgo: 0, hh: 9, mm: 10, agent: 0, priority: "0", moveInDays: 21, jobNo: true, phoneSlot: 1 },
  { key: "new-day1-b", case: "new_day1", daysAgo: 0, hh: 10, mm: 25, agent: 1, priority: "0", moveInDays: 28, jobNo: true, phoneSlot: 2 },
  { key: "new-day1-c", case: "new_day1", daysAgo: 0, hh: 11, mm: 40, agent: 2, priority: "0", moveInDays: 35, jobNo: true, phoneSlot: 3 },
  { key: "new-day3-a", case: "new_day3", daysAgo: 2, hh: 9, mm: 30, agent: 0, priority: "0", moveInDays: 24, jobNo: true, phoneSlot: 4 },
  { key: "new-day3-b", case: "new_day3", daysAgo: 2, hh: 13, mm: 5, agent: 1, priority: "0", moveInDays: 30, jobNo: true, phoneSlot: 5 },
  { key: "new-day3-c", case: "new_day3", daysAgo: 2, hh: 16, mm: 45, agent: 2, priority: "0", moveInDays: 42, jobNo: true, phoneSlot: 6 },
  { key: "new-day4-a", case: "new_day4", daysAgo: 3, hh: 8, mm: 50, agent: 0, priority: "0", moveInDays: 26, jobNo: true, phoneSlot: 7 },
  { key: "new-day4-b", case: "new_day4", daysAgo: 3, hh: 14, mm: 15, agent: 1, priority: "0", moveInDays: 33, jobNo: true, phoneSlot: 8 },
  { key: "new-day6-a", case: "new_day6", daysAgo: 5, hh: 10, mm: 0, agent: 2, priority: "0", moveInDays: 22, jobNo: true, phoneSlot: 9 },
  { key: "new-day6-b", case: "new_day6", daysAgo: 5, hh: 17, mm: 20, agent: 0, priority: "0", moveInDays: 40, jobNo: true, phoneSlot: 10 },
  { key: "quoted-selected-a", case: "quoted_selected_date_pending", daysAgo: 4, hh: 11, mm: 0, agent: 1, priority: "1", moveInDays: 27, jobNo: true, phoneSlot: 11 },
  { key: "quoted-selected-b", case: "quoted_selected_date_pending", daysAgo: 4, hh: 15, mm: 30, agent: 2, priority: "1", moveInDays: 31, jobNo: true, phoneSlot: 12 },
  { key: "quoted-no-date", case: "quoted_no_selected_date", daysAgo: 6, hh: 12, mm: 10, agent: 0, priority: "1", moveInDays: 29, jobNo: true, phoneSlot: 13 },
  { key: "unassigned-new", case: "unassigned_new", daysAgo: 1, hh: 9, mm: 45, agent: null, priority: "0", moveInDays: 25, jobNo: true, phoneSlot: 14 },
  { key: "unassigned-quoted", case: "unassigned_quoted", daysAgo: 7, hh: 13, mm: 55, agent: null, priority: "1", moveInDays: 36, jobNo: true, phoneSlot: 15 },
  { key: "priority-3", case: "priority_3_discretion", daysAgo: 8, hh: 10, mm: 35, agent: 1, priority: "3", moveInDays: 45, jobNo: true, phoneSlot: 16 },
  { key: "priority-9", case: "unmapped_priority_9", daysAgo: 9, hh: 11, mm: 15, agent: 2, priority: "9", moveInDays: 38, jobNo: true, phoneSlot: 17 },
  { key: "restricted", case: "restricted_number", daysAgo: 1, hh: 15, mm: 0, agent: 0, priority: "0", moveInDays: 23, jobNo: true, phoneSlot: 18 },
  { key: "shared-a", case: "shared_phone", daysAgo: 2, hh: 10, mm: 5, agent: 1, priority: "0", moveInDays: 32, jobNo: true, phoneSlot: 19 },
  { key: "shared-b", case: "shared_phone", daysAgo: 1, hh: 12, mm: 40, agent: 2, priority: "0", moveInDays: 32, jobNo: true, phoneSlot: 19 },
  { key: "missing-job", case: "missing_job_number", daysAgo: 1, hh: 16, mm: 10, agent: 0, priority: "0", moveInDays: 34, jobNo: false, phoneSlot: 20 },
  { key: "older", case: "not_enrolled_older", daysAgo: 100, hh: 10, mm: 20, agent: 1, priority: "0", moveInDays: -40, jobNo: true, phoneSlot: 21 },
];

const AGENT_SPECS = [
  { key: "agent-avery", name: "Pilot Rep Avery", extension: "101" },
  { key: "agent-blake", name: "Pilot Rep Blake", extension: "102" },
  { key: "agent-casey", name: "Pilot Rep Casey", extension: "103" },
] as const;

const CUSTOMER_NAMES = [
  "Morgan Ellis", "Jordan Reyes", "Taylor Nguyen", "Riley Okafor", "Casey Lindqvist", "Avery Brandt", "Quinn Delgado",
  "Harper Ostrowski", "Rowan Castillo", "Emerson Vale", "Sawyer Petrov", "Finley Adebayo", "Dakota Marsh", "Reese Halloran",
  "Skyler Imani", "Parker Whitfield", "Hayden Solis", "Kendall Moreau", "Blair Tanaka", "Blair Tanaka", "Jules Fontaine", "Micah Oduya",
];

async function main() {
  const { connectMongo } = await import("../../src/db.js");
  const { Agent } = await import("../../src/models/Agent.js");
  const { getRepIdentityLinkModel } = await import("../../src/models/RepIdentityLink.js");
  const { getContactNumberModel } = await import("../../src/models/ContactNumber.js");

  const { getSalesIntelligenceContactRestrictionModel } = await import("../../src/models/SalesIntelligenceContactRestriction.js");
  const { toE164, toNationalTenDigit, reverseDigits } = await import("../../src/services/numberActivity/phone.js");
  const { normalizePhoneNumberForMatch } = await import("../../src/utils/phone.js");
  const { normalizeJobNo } = await import("../../src/services/bookings/bookingIdentity.js");
  const { easternDateTimeParts, easternWallClockToUtc } = await import("../../src/utils/easternTime.js");

  await connectMongo();
  if (mongoose.connection.name !== args.database)
    refuse(`connected to database "${mongoose.connection.name}" but --database=${args.database} was requested`);
  const db = mongoose.connection.db;
  if (!db) refuse("database handle unavailable");

  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  const populated: string[] = [];
  for (const name of SEEDED_COLLECTIONS) if (existing.has(name) && (await db.collection(name).countDocuments({})) > 0) populated.push(name);
  if (populated.length && !args.reset) refuse(`${args.database} already has rows in ${populated.join(", ")}; pass --reset to drop those collections first`);
  if (args.reset) for (const name of SEEDED_COLLECTIONS) if (existing.has(name)) await db.collection(name).drop();

  const asOf = args.asOf;
  const nyNow = easternDateTimeParts(asOf);
  const today: NyDate = { y: nyNow.year, m: nyNow.month, d: nyNow.day };
  /** ET wall clock stored in a UTC Date (`toFloridaTimestamp` convention) plus the real instant it names. */
  const received = (daysAgo: number, hh: number, mm: number) => {
    const day = shiftDays(today, -daysAgo);
    let hour = hh, minute = mm;
    if (daysAgo === 0 && (hh > nyNow.hour || (hh === nyNow.hour && mm >= nyNow.minute))) {
      // "Received today" must already have happened at --as-of: pull it two hours back, bounded at 00:05.
      hour = Math.max(0, nyNow.hour - 2);
      minute = nyNow.hour >= 2 ? nyNow.minute : 5;
    }
    const wall = new Date(Date.UTC(day.y, day.m - 1, day.d, hour, minute, 0));
    const instant = easternWallClockToUtc(day.y, day.m, day.d, hour, minute, 0) ?? new Date(+wall + 5 * 3_600_000);
    return { wall, instant, date: isoDate(day) };
  };
  const stamp = (doc: Record<string, unknown>, at: Date) => ({ ...doc, createdAt: at, updatedAt: at });
  /** Build through the model (strict: "throw" + enum/required validation), insert raw: no unique-fence precondition. */
  const validated = (Model: mongoose.Model<any>, doc: Record<string, unknown>) => {
    const built = new Model(doc);
    const error = built.validateSync();
    if (error) throw error;
    return built.toObject({ depopulate: true, versionKey: false }) as Record<string, unknown>;
  };

  // --- Agents + reviewed sales_rep identity links -------------------------------------------------------
  const effectiveFrom = new Date("2026-01-01T05:00:00.000Z");
  const agents = AGENT_SPECS.map((spec) => ({ ...spec, _id: oid(spec.key), linkId: oid(`${spec.key}:link`) }));
  await db.collection("agents").insertMany(
    agents.map((a) =>
      validated(Agent, stamp({
        _id: a._id, name: a.name, normalized_name: a.name.toLowerCase(), active: true, role: "agent", created_from: "sod_pilot_seed",
        name_aliases: [], granot_identity: { verified: false },
      }, effectiveFrom)),
    ),
  );
  await db.collection("rep_identity_links").insertMany(
    agents.map((a) =>
      validated(getRepIdentityLinkModel(), stamp({
        _id: a.linkId, revision: 1, agent_id: a._id, agent_name_snapshot: a.name, rc_account_id: "pilot", rc_extension_id: a.extension,
        rc_extension_number: a.extension, rc_extension_name_snapshot: a.name, rc_direct_numbers: [], rc_sms_sender_number: null,
        rc_team_messaging_person_id: null, rc_direct_chat_id: null, extension_user_id: null, granot_username: null,
        role_kind: "sales_rep", status: "reviewed", proposal_basis: "exact_full_name", nudge_channels_allowed: ["team_messaging"],
        effective_from: effectiveFrom, effective_to: null, reviewed_by: "sod-pilot-seed", reviewed_at: effectiveFrom,
        history: [{ at: effectiveFrom, by: "sod-pilot-seed", change: "reviewed" }],
      }, effectiveFrom)),
    ),
  );

  // --- Form Leads -----------------------------------------------------------------------------------------
  const leads = LEAD_SPECS.map((spec, index) => {
    const _id = oid(`lead:${spec.key}`);
    const when = received(spec.daysAgo, spec.hh, spec.mm);
    const createdAt = new Date(+when.instant + 3_000);
    const phone = `(555) 010-${pad(spec.phoneSlot).padStart(4, "0")}`;
    const normalizedPhone = normalizePhoneNumberForMatch(phone);
    if (!normalizedPhone) throw new Error(`phone ${phone} does not normalize`);
    const jobNo = spec.jobNo ? `JOB-${2001 + index}` : null;
    const agent = spec.agent === null ? null : agents[spec.agent]!;
    const moveDate = utcMidnight(shiftDays(today, spec.moveInDays));
    const doc: Record<string, unknown> = {
      _id,
      ingestion_origin: "wordpress_form",
      timestamp: when.wall,
      createdAt,
      updatedAt: createdAt,
      domain_revision: 1,
      last_changed_at: createdAt,
      name: CUSTOMER_NAMES[index],
      phone_number: phone,
      normalized_phone_number: normalizedPhone,
      pickup_zip: "33301",
      destination_zip: "30301",
      pickup_city: "Fort Lauderdale",
      delivery_city: "Atlanta",
      pickup_state: "FL",
      delivery_state: "GA",
      move_date: moveDate,
      duplicate: false,
      no_sync: false,
      post_to_granot: true,
      granot_priority: spec.priority,
      last_accepted_granot_observation: { observation_id: oid(`observation:${spec.key}`), captured_at: new Date(+when.instant + 60_000) },
      ...(jobNo ? { job_no: jobNo, normalized_job_no: normalizeJobNo(jobNo) } : {}),
      ...(agent
        ? { receiver_agent: agent._id, receiver_agent_name_snapshot: agent.name, receiver_agent_source: "manual", receiver_agent_set_at: createdAt }
        : {}),
    };
    return { spec, _id, doc, phone, normalizedPhone, jobNo, agent, receivedDate: when.date, receivedInstant: when.instant, moveDate: moveDate.toISOString().slice(0, 10), name: CUSTOMER_NAMES[index]! };
  });
  await db.collection("form_leads").insertMany(leads.map((l) => l.doc));

  // --- Contact Numbers and their All Numbers lead link --------------------------------------------------
  const byPhone = new Map<string, typeof leads>();
  for (const lead of leads) byPhone.set(lead.normalizedPhone, [...(byPhone.get(lead.normalizedPhone) ?? []), lead]);
  const numbers: Array<{ _id: mongoose.Types.ObjectId; e164: string; lead_ids: string[] }> = [];
  for (const [normalizedPhone, attached] of byPhone) {
    const e164 = toE164(normalizedPhone);
    if (!e164) throw new Error(`phone ${normalizedPhone} has no E.164 form`);
    const _id = oid(`number:${e164}`);
    const firstObserved = new Date(Math.min(...attached.map((l) => +l.receivedInstant)));
    const lastObserved = new Date(Math.max(...attached.map((l) => +l.receivedInstant)));
    numbers.push({ _id, e164, lead_ids: attached.map((l) => String(l._id)) });
    await db.collection("contact_numbers").insertOne(
      validated(getContactNumberModel(), stamp({
        _id, purged_at: null, revision: 1, e164, national_ten: toNationalTenDigit(e164), digits_reversed: reverseDigits(e164), country: "US",
        provider_names: [],
        search_terms: [...new Set(attached.flatMap((l) => [l.name.toLowerCase(), ...(l.jobNo ? [l.jobNo.toLowerCase()] : [])]))],
        first_observed_at: firstObserved, last_activity_at: lastObserved, created_via: "form_lead",
        // The automatic link: the newest Lead on the phone is the number's Lead, the rest are other Leads.
        ...(() => {
          const linked = [...attached].sort((a, b) => +b.receivedInstant - +a.receivedInstant).map((lead) => ({
            model: "FormLead", id: lead._id, name: lead.name, job_no: lead.jobNo, receiver_agent_id: lead.agent?._id ?? null,
            receiver_agent_name: lead.agent?.name ?? null, received_at: lead.receivedInstant, state: "open",
          }));
          return { lead: linked[0] ?? null, other_leads: linked.slice(1), lead_link: { source: "automatic", set_at: firstObserved, set_by: null, excluded: [] }, summary_version: 1 };
        })(),
      }, firstObserved)),
    );
  }

  // --- One active, unconfirmed intelligence-origin restriction (P06c "needs review") ----------------------
  const restrictedLead = leads.find((l) => l.spec.case === "restricted_number")!;
  const restrictedNumber = numbers.find((n) => n.lead_ids.includes(String(restrictedLead._id)))!;
  const restrictionId = oid("restriction:restricted");
  const restrictedAt = new Date(+restrictedLead.receivedInstant + 30 * 60_000);
  await db.collection("sales_intelligence_contact_restrictions").insertOne(
    validated(getSalesIntelligenceContactRestrictionModel(), stamp({
      _id: restrictionId, contact_number_id: restrictedNumber._id, source_interaction_id: null, channels: ["call", "text"], until: null,
      origin: "intelligence", actor: { kind: "intelligence", id: "sod-pilot-seed", request_id: "sod-pilot-seed", run_id: null },
      run_id: null, finding_id: null, reason: null, confirmed_at: null, confirmation_actor: null, resolution_actor: null,
      resolved_at: null, resolution_reason: null, state: "active", revision: 1,
    }, restrictedAt)),
  );

  // --- Summary ---------------------------------------------------------------------------------------------
  const grouped: Record<string, { label: string; leads: Array<Record<string, unknown>> }> = {};
  for (const lead of leads) {
    const group = (grouped[lead.spec.case] ??= { label: CASE_LABELS[lead.spec.case], leads: [] });
    group.leads.push({
      lead_id: String(lead._id), name: lead.name, phone: lead.phone, e164: numbers.find((n) => n.lead_ids.includes(String(lead._id)))!.e164,
      job_no: lead.jobNo, granot_priority: lead.spec.priority, received_date_ny: lead.receivedDate, move_date: lead.moveDate,
      receiver_agent_id: lead.agent ? String(lead.agent._id) : null, receiver_agent: lead.agent?.name ?? null,
    });
  }
  const summary = {
    database: args.database,
    as_of: asOf.toISOString(),
    as_of_new_york_date: isoDate(today),
    counts: Object.fromEntries(await Promise.all(SEEDED_COLLECTIONS.map(async (name) => [name, await db.collection(name).countDocuments({})]))),
    agents: agents.map((a) => ({ agent_id: String(a._id), name: a.name, rc_extension_id: a.extension, rep_identity_link_id: String(a.linkId) })),
    leads_by_case: grouped,
    numbers: numbers.map((n) => ({ number_id: String(n._id), e164: n.e164, lead_ids: n.lead_ids })),
    restriction: { restriction_id: String(restrictionId), number_id: String(restrictedNumber._id), lead_id: String(restrictedLead._id), origin: "intelligence", confirmed_at: null, channels: ["call", "text"] },
  };
  console.log(JSON.stringify(summary, null, 2));

  const uri = process.env.MONGO_URI!;
  const env = `TEST_MODE=true TEST_MONGO_DATABASE_NAME=${args.database} MONGO_URI="${uri}" SHEET_SYNC_MODE=disabled`;
  const lines = [
    "",
    "# Admin users (run in vantage-admin; its own auth database, never written by this seed).",
    "# Point vantage-admin/.env at the replica first: MONGODB_URI=mongodb://127.0.0.1:27189/?replicaSet=csi01  ADMIN_AUTH_DB_NAME=testvantageadmin_sodpilot",
    "# Roles are the admin AdminUser enum (owner | admin | rep, plus manager once the A1 lane lands it in server/models/adminRoles.ts).",
    "# Passwords must satisfy the admin policy (10 characters to 72 bytes); replace the placeholders.",
    `NEW_SEED_EMAIL=owner@pilot.local NEW_SEED_PASSWORD='<owner password>' NEW_SEED_ROLE=owner pnpm seed:admin`,
    `NEW_SEED_EMAIL=manager@pilot.local NEW_SEED_PASSWORD='<manager password>' NEW_SEED_ROLE=manager pnpm seed:admin`,
    ...agents.map((a) => `NEW_SEED_EMAIL=${a.key.replace("agent-", "")}@pilot.local NEW_SEED_PASSWORD='<rep password>' NEW_SEED_ROLE=rep pnpm seed:admin --agent-id=${String(a._id)}   # ${a.name}, ext ${a.extension}`),
    "",
    "# Next runbook steps against this database (SPRINT-RUNBOOK P2 step 1 then enrollment); pnpm scripts load .env, so pass the env inline with node:",
    `${env} node --import tsx ops/sales-outreach/build-indexes.ts --target=${args.database} --apply`,
    `${env} node --import tsx ops/sales-outreach/install-approved-policy.ts --target=${args.database} --apply --enable=desk_enabled,goal_metrics_enabled`,
    `${env} node --import tsx ops/sales-outreach/enrollment.ts --target=${args.database}`,
    `${env} node --import tsx ops/sales-outreach/enrollment.ts apply --target=${args.database} --kind=pilot --run-key=pilot-${isoDate(today)}`,
    `${env} node --import tsx ops/sales-outreach/enrollment.ts verify --target=${args.database} --run-key=pilot-${isoDate(today)}`,
  ];
  console.log(lines.join("\n"));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
