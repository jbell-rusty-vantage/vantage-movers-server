/**
 * Rep Team Messaging backfill (2026-09-25). The Owner's "Message rep" sends on `team_messaging` (pager fallback), which
 * needs the rep link's `rc_team_messaging_person_id` and `team_messaging` in `nudge_channels_allowed`. The rep review
 * never resolved person ids, so every reviewed link lacked both and every send failed `NUDGE_CONFIGURATION_UNAVAILABLE`.
 *
 * For each current reviewed `sales_rep` link it asks RingCentral who the rep is in Team Messaging
 * (`GET /restapi/v1.0/glip/persons/{extensionId}`) and records the id only when RingCentral answers with that same
 * person. It never invents an id: a rep RingCentral can't resolve is reported and left alone.
 *
 *   node --env-file=.env --import tsx ops/backfill-rep-team-messaging.ts --dry-run
 *   node --env-file=.env --import tsx ops/backfill-rep-team-messaging.ts --apply --i-know-this-is-production
 *
 * Dry run is the default and read-only (a RingCentral GET per rep). `--apply` writes each link through
 * `executeCsiCommand` as the operator (`csiOperatorActor`): revision + 1, a history line and a `rep.team_messaging_backfill`
 * audit row, idempotent per link revision. Against production it needs the confirm flag and the drift guard.
 */
import mongoose from "mongoose";
import { z } from "zod";
import { connectMongo } from "../src/db";
import { getMongoDatabaseName } from "../src/config/domain/runtime";
import { csiNudgeConfiguration } from "../src/config/domain/salesIntelligence";
import { getRepIdentityLinkModel } from "../src/models/RepIdentityLink";
import { getValidToken } from "../src/services/ringcentral/auth";
import { csiOperatorActor } from "../src/services/salesIntelligence/auth";
import { appendCsiAudit, executeCsiCommand } from "../src/services/salesIntelligence/transactions";
import { toRepLinkDto } from "../src/services/salesIntelligence/repIdentity/reads";
import { assertProductionWriterMatchesDeployment } from "./lib/production-writer-guard";

const flag = (name: string) => process.argv.includes(`--${name}`);
export const PRODUCTION_CONFIRM_FLAG = "--i-know-this-is-production";
const id = z.union([z.string().min(1), z.number().int().nonnegative()]).transform(String);

async function rcGet(path: string): Promise<{ status: number; value: unknown }> {
  const server = process.env.RC_SERVER_URL;
  if (!server || !/^https:\/\/platform(?:\.devtest)?\.ringcentral\.com\/?$/.test(server)) throw new Error("RC_SERVER_URL is not a RingCentral platform URL");
  const token = await getValidToken();
  const response = await fetch(`${server.replace(/\/$/, "")}${path}`, { headers: { Authorization: `Bearer ${token.access_token}` }, redirect: "error", signal: AbortSignal.timeout(10_000) });
  return { status: response.status, value: response.ok ? await response.json() : await response.text() };
}

async function main() {
  const apply = flag("apply");
  if (apply && flag("dry-run")) throw new Error("Pass --dry-run or --apply, not both");
  mongoose.set("autoIndex", false); mongoose.set("autoCreate", false);
  await connectMongo();
  const production = getMongoDatabaseName() === "vantagemovers";
  if (apply && production) {
    if (!process.argv.includes(PRODUCTION_CONFIRM_FLAG)) throw new Error(`Refusing to --apply against the production database without ${PRODUCTION_CONFIRM_FLAG}`);
    await assertProductionWriterMatchesDeployment();
  }
  const config = csiNudgeConfiguration();
  const self = await rcGet("/restapi/v1.0/glip/persons/~");
  const sender = z.object({ id }).safeParse(self.value);
  console.log(JSON.stringify({ event: "sender", status: self.status, matches_config: sender.success && sender.data.id === config.senderPerson }));

  const Model = getRepIdentityLinkModel();
  const links = await Model.find({ rc_account_id: config.account, status: "reviewed", role_kind: "sales_rep", effective_to: null }).lean();
  const counts = { links: links.length, already: 0, resolved: 0, written: 0, unresolved: 0, sender: 0 };
  for (const link of links) {
    const row = { link_id: String(link._id), agent: link.agent_name_snapshot ?? String(link.agent_id), extension: link.rc_extension_id };
    if (link.rc_extension_id === config.senderExtension) { counts.sender++; console.log(JSON.stringify({ event: "skip_sender", ...row })); continue; }
    if (link.rc_team_messaging_person_id && link.nudge_channels_allowed.includes("team_messaging")) { counts.already++; console.log(JSON.stringify({ event: "already", ...row })); continue; }
    const person = await rcGet(`/restapi/v1.0/glip/persons/${encodeURIComponent(link.rc_extension_id)}`);
    const parsed = z.object({ id }).safeParse(person.value);
    if (person.status !== 200 || !parsed.success || parsed.data.id !== link.rc_extension_id) {
      counts.unresolved++; console.log(JSON.stringify({ event: "unresolved", ...row, status: person.status })); continue;
    }
    counts.resolved++;
    const personId = parsed.data.id;
    if (!apply) { console.log(JSON.stringify({ event: "would_write", ...row, person_id: personId })); continue; }
    const actor = csiOperatorActor(`rep-team-messaging-backfill:${link._id}:r${link.revision}`);
    await executeCsiCommand({ actor, command: "backfill_rep_team_messaging", idempotency_key: `rep-team-messaging:${link._id}:r${link.revision}`,
      payload: { id: String(link._id), person_id: personId }, operation: async context => {
        const current = await Model.findById(link._id).session(context.session);
        if (!current || current.revision !== link.revision) throw new Error(`link ${link._id} changed; re-run`);
        const prior = toRepLinkDto(current);
        current.rc_team_messaging_person_id = personId;
        current.nudge_channels_allowed = ["team_messaging", ...current.nudge_channels_allowed.filter(channel => channel !== "team_messaging")];
        current.revision++;
        current.history.push({ at: context.now, by: context.actor.id, change: "Team Messaging person id resolved from RingCentral (backfill)" });
        await current.save({ session: context.session });
        await appendCsiAudit(context, { kind: "rep", subject_key: `rep:${current._id}`, target_id: String(current._id), revision: current.revision,
          event_kind: "rep.team_messaging_backfill", prior, current: toRepLinkDto(current) });
        return { id: String(current._id), revision: current.revision };
      } });
    counts.written++;
    console.log(JSON.stringify({ event: "written", ...row, person_id: personId }));
  }
  console.log(JSON.stringify({ event: "done", mode: apply ? "apply" : "dry-run", database: getMongoDatabaseName(), ...counts }));
}

main().then(() => mongoose.disconnect()).catch(async error => { console.error(error instanceof Error ? error.message : error); await mongoose.disconnect(); process.exit(1); });
