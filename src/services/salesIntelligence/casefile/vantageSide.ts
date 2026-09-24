import mongoose from "mongoose";
import { getCallInteractionModel } from "../../../models/CallInteraction";
import { getRepIdentityLinkModel } from "../../../models/RepIdentityLink";
import { getRingCentralDirectorySnapshotModel } from "../../../models/RingCentralDirectorySnapshot";
import { getRingCentralInboundRouteModel } from "../../../models/RingCentralInboundRoute";
import { normalizePhoneNumberForMatch } from "../../../utils/phone";
import { redactTranscript } from "../../conversations/redaction";
import { resolveRepIdentityAt, type TemporalRepLink } from "../repIdentity/resolve";
import type { CaseCall, CaseCallParty, CaseDirectory, CaseLead, CaseRepLink, CaseRoute, VantageSideContext } from "./types";

/**
 * F6 (spec §4.5): the Vantage side of every call — the line dialled and the rep — from Vantage
 * configuration and provider facts only, never from the model.
 *
 * Line label lookup order: (1) the inbound route catalog capture already joins (`inbound_route_id`,
 * else the route whose number is the call's `company_e164`); (2) the Call Lead's qualifying call
 * (`ringcentral.target_name` / `source_label`); (3) the formatted number alone.
 *
 * Rep, per the answering (or dialling) user party, through `RepIdentityLink` at the call time:
 * reviewed sales rep → the reviewed name; anything else → the extension, with the RingCentral
 * directory-sync name marked as a label ("identity not reviewed"); no extension → "a Vantage line".
 * Deterministic assignment keeps using reviewed identities only; this is presentation.
 */
const clean = (value: unknown, max = 80): string | null => {
  if (value === null || value === undefined) return null;
  const text = redactTranscript(String(value)).text.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};
const phoneKey = (value: string | null | undefined) => (value ? normalizePhoneNumberForMatch(value) : null);

export type RepClause = {
  kind: "reviewed" | "unreviewed" | "excluded_role" | "no_extension";
  agent_id: string | null; name: string | null; extension: string | null; directory_name: string | null; role_kind: string | null;
  /** `Jordan Bell (ext 104, reviewed)` / `ext 118 (identity not reviewed; directory name "Mike R.")` / `a Vantage line`. */
  text: string;
  /** The §1 "Phone reps seen" form: `Jordan Bell` / `ext 118 "Mike R." [directory name, unreviewed]`. */
  short: string;
};
export type LineLabel = { label: string | null; e164: string | null; source: "route" | "call_lead" | "number" | "unknown" };
export type VantageSide = {
  line: LineLabel;
  /** `Top10 line` / `Vantage line (+18885550100)` / `a Vantage line`. */
  line_text: string;
  queue: { name: string | null; rang: number } | null;
  transferred_from: string | null;
  rep: RepClause;
};

/** The user party that answered (connected, with an extension), else the first user party with an extension. */
export function userParty(call: Pick<CaseCall, "parties">): CaseCallParty | null {
  return call.parties.find(p => p.role === "user" && p.connected && p.extension_id) ?? call.parties.find(p => p.role === "user" && p.extension_id) ?? null;
}

function temporal(links: readonly CaseRepLink[]): TemporalRepLink[] {
  return links.map(l => ({ _id: l.id, revision: l.revision, agent_id: l.agent_id, rc_account_id: l.rc_account_id, rc_extension_id: l.rc_extension_id, role_kind: l.role_kind,
    status: l.status, effective_from: new Date(l.effective_from), effective_to: l.effective_to ? new Date(l.effective_to) : null,
    reviewed_at: l.reviewed_at ? new Date(l.reviewed_at) : null, reviewed_by: l.reviewed_by }));
}

export function repClause(call: Pick<CaseCall, "parties" | "provider_account_id" | "started_at">, ctx: VantageSideContext): RepClause {
  const party = userParty(call);
  if (!party?.extension_id) return { kind: "no_extension", agent_id: null, name: null, extension: null, directory_name: null, role_kind: null, text: "a Vantage line", short: "a Vantage line" };
  const directory = ctx.directories.find(d => d.account_id === call.provider_account_id);
  const listed = directory?.extensions[party.extension_id] ?? null;
  const scoped = ctx.links.filter(l => l.rc_account_id === call.provider_account_id && l.rc_extension_id === party.extension_id);
  const extension = clean(party.extension_number ?? listed?.extension_number ?? scoped.find(l => l.rc_extension_number)?.rc_extension_number ?? party.extension_id, 20)!;
  const directoryName = clean(listed?.name ?? scoped.find(l => l.rc_extension_name)?.rc_extension_name ?? null, 60);
  const resolution = resolveRepIdentityAt(temporal(scoped), call.provider_account_id, party.extension_id, new Date(call.started_at));
  const link = resolution.link_id ? scoped.find(l => l.id === resolution.link_id) ?? null : null;
  const named = directoryName ? `; directory name "${directoryName}"` : "";
  if (resolution.status === "reviewed" && link) {
    const name = clean(link.agent_name, 60) ?? `agent ${link.agent_id}`;
    return { kind: "reviewed", agent_id: resolution.agent_id, name, extension, directory_name: directoryName, role_kind: link.role_kind,
      text: `${name} (ext ${extension}, reviewed)`, short: name };
  }
  if (resolution.status === "excluded_role" && link) {
    const role = clean(link.role_kind, 20)!.replace(/_/g, " ");
    return { kind: "excluded_role", agent_id: null, name: null, extension, directory_name: directoryName, role_kind: link.role_kind,
      text: `ext ${extension} (reviewed as ${role}, not a sales rep${named})`, short: `ext ${extension}${directoryName ? ` "${directoryName}"` : ""} [${role}]` };
  }
  return { kind: "unreviewed", agent_id: null, name: null, extension, directory_name: directoryName, role_kind: null,
    text: `ext ${extension} (identity not reviewed${named})`, short: `ext ${extension}${directoryName ? ` "${directoryName}" [directory name, unreviewed]` : " [unreviewed]"}` };
}

export function lineLabel(call: Pick<CaseCall, "company_e164" | "inbound_route_id" | "telephony_session_id">, ctx: VantageSideContext): LineLabel {
  const e164 = call.company_e164 ?? null;
  const key = phoneKey(e164);
  const route = (call.inbound_route_id ? ctx.routes.find(r => r.id === call.inbound_route_id) : undefined) ?? (key ? ctx.routes.find(r => phoneKey(r.phone_number) === key) : undefined);
  if (route) return { label: clean(route.display_label, 60), e164, source: "route" };
  const lead = (call.telephony_session_id ? ctx.call_leads.find(l => l.telephony_session_id && l.telephony_session_id === call.telephony_session_id) : undefined)
    ?? (key ? ctx.call_leads.find(l => phoneKey(l.target_phone_number) === key) : undefined);
  const leadLabel = clean(lead?.target_name ?? lead?.source_label ?? null, 60);
  if (leadLabel) return { label: leadLabel, e164, source: "call_lead" };
  return { label: null, e164, source: e164 ? "number" : "unknown" };
}
export function lineText(line: LineLabel, withNumber = false): string {
  // `Top10` → `Top10 line`; a label that already names a line (`Sales Overflow Line`) is not doubled.
  if (line.label) return `${line.label}${/\bline$/i.test(line.label) ? "" : " line"}${withNumber && line.e164 ? ` (${line.e164})` : ""}`;
  return line.e164 ? `Vantage line (${line.e164})` : "a Vantage line";
}

export function vantageSide(call: CaseCall, ctx: VantageSideContext): VantageSide {
  const line = lineLabel(call, ctx);
  const users = [...new Set(call.parties.filter(p => p.role === "user" && p.extension_id).map(p => p.extension_id!))];
  const queueParty = call.parties.find(p => p.role === "queue") ?? null;
  const directory = ctx.directories.find(d => d.account_id === call.provider_account_id);
  const route = call.inbound_route_id ? ctx.routes.find(r => r.id === call.inbound_route_id) : undefined;
  const queueName = clean(queueParty?.name_raw ?? (queueParty?.extension_id ? directory?.queues[queueParty.extension_id]?.name : null) ?? route?.queue_name ?? null, 60);
  const queue = call.queue_fanout || queueParty ? { name: queueName, rang: users.length } : null;
  const answering = userParty(call);
  const from = call.transfer ? call.parties.find(p => p.role === "user" && p.extension_id && p.extension_id !== answering?.extension_id) ?? null : null;
  const transferredFrom = from ? `ext ${clean(from.extension_number ?? directory?.extensions[from.extension_id!]?.extension_number ?? from.extension_id, 20)}` : call.transfer ? "another line" : null;
  return { line, line_text: lineText(line), queue, transferred_from: transferredFrom, rep: repClause(call, ctx) };
}

/**
 * The clause after `C0 outbound` / `C1 inbound`: `from Top10 line by Jordan Bell (ext 104, reviewed)`,
 * `to Main line, queue "Sales" rang 3; answered by ext 118 (identity not reviewed)`.
 */
export function vantageClauseText(side: VantageSide, direction: string, connected: boolean, withNumber = false): string {
  const line = lineText(side.line, withNumber);
  const queue = side.queue ? `, queue${side.queue.name ? ` "${side.queue.name}"` : ""}${side.queue.rang ? ` rang ${side.queue.rang}` : ""}` : "";
  const transfer = side.transferred_from ? `; transferred from ${side.transferred_from}` : "";
  if (direction === "Outbound") return `from ${line} by ${side.rep.text}${transfer}`;
  if (direction === "Inbound") return `to ${line}${queue}${transfer}${connected ? `; answered by ${side.rep.text}` : ""}`;
  return `on ${line}${side.rep.kind === "no_extension" ? "" : ` (${side.rep.text})`}`;
}

// ---------------------------------------------------------------------------------------------
// Reads (bounded, indexed, read only)
// ---------------------------------------------------------------------------------------------

type CallRow = { _id: unknown; provider_account_id: string; telephony_session_id?: string | null; direction: string; started_at: Date; company_e164?: string | null;
  inbound_route_id?: unknown; parties?: Array<{ role: string; extension_id?: string | null; extension_number?: string | null; name_raw?: string | null; connected?: boolean }>;
  queue_fanout?: boolean; transfer?: boolean; duration_seconds?: number | null; provider_result?: string | null; provider_connected?: boolean; contact_type?: string; contact_type_basis?: string | null;
  recordings?: unknown[] };
export function toCaseCall(row: CallRow): CaseCall {
  return { id: String(row._id), provider_account_id: row.provider_account_id, telephony_session_id: row.telephony_session_id ?? null, direction: row.direction,
    started_at: row.started_at.toISOString(), company_e164: row.company_e164 ?? null, inbound_route_id: row.inbound_route_id ? String(row.inbound_route_id) : null,
    parties: (row.parties ?? []).map(p => ({ role: p.role, extension_id: p.extension_id ?? null, extension_number: p.extension_number ?? null, name_raw: p.name_raw ?? null, connected: Boolean(p.connected) })),
    queue_fanout: Boolean(row.queue_fanout), transfer: Boolean(row.transfer), duration_seconds: typeof row.duration_seconds === "number" ? row.duration_seconds : null,
    provider_result: row.provider_result ?? null, provider_connected: Boolean(row.provider_connected), contact_type: row.contact_type ?? "unknown", recording_count: (row.recordings ?? []).length,
    contact_type_basis: row.contact_type_basis ?? null };
}
export const CALL_PROJECTION = "provider_account_id telephony_session_id direction started_at company_e164 inbound_route_id parties queue_fanout transfer duration_seconds provider_result provider_connected contact_type contact_type_basis recordings";

/**
 * The Number's canonical calls, newest `limit` at or before `as_of`, oldest first. A call still in
 * progress (`terminal: false`) is not a Case File fact (G2): it is left out and its id reported in
 * `in_progress_ids`, so the file of a Number without one is unchanged.
 */
export async function readCaseCalls(numberId: string, asOf: Date, limit: number): Promise<{ calls: CaseCall[]; truncated: boolean; in_progress_ids: string[] }> {
  if (!mongoose.isValidObjectId(numberId)) return { calls: [], truncated: false, in_progress_ids: [] };
  const rows = await getCallInteractionModel().find({ contact_number_id: new mongoose.Types.ObjectId(numberId), merged_into_id: null, purged_at: null, started_at: { $lte: asOf } })
    .select(`${CALL_PROJECTION} terminal`).sort({ started_at: -1, _id: -1 }).limit(limit + 1).lean();
  const page = (rows as unknown as Array<CallRow & { terminal?: boolean | null }>).slice(0, limit);
  return { calls: page.filter(row => row.terminal !== false).reverse().map(toCaseCall), truncated: rows.length > limit,
    in_progress_ids: page.filter(row => row.terminal === false).map(row => String(row._id)) };
}

/** Links, the newest directory snapshot per account, the inbound routes and the Call Leads' qualifying calls. */
export async function readVantageSideContext(calls: readonly CaseCall[], leads: readonly CaseLead[]): Promise<VantageSideContext> {
  const accounts = [...new Set(calls.map(c => c.provider_account_id))].slice(0, 20);
  const extensions = [...new Set(calls.flatMap(c => c.parties.flatMap(p => (p.extension_id ? [p.extension_id] : []))))].slice(0, 400);
  // Routes the calls name, and the routes of the Call Leads' qualifying calls (§2 names the route).
  const routeIds = [...new Set([...calls.flatMap(c => (c.inbound_route_id ? [c.inbound_route_id] : [])), ...leads.flatMap(l => (l.ringcentral?.route_id ? [l.ringcentral.route_id] : []))])]
    .filter(id => mongoose.isValidObjectId(id));
  const numbers = [...new Set(calls.flatMap(c => (c.company_e164 ? [c.company_e164] : [])))];
  const numberVariants = [...new Set(numbers.flatMap(n => { const ten = phoneKey(n); return ten ? [n, ten, `+1${ten}`, `1${ten}`] : [n]; }))];
  const [links, directories, routes] = await Promise.all([
    accounts.length && extensions.length ? getRepIdentityLinkModel().find({ rc_account_id: { $in: accounts }, rc_extension_id: { $in: extensions } }).limit(500).lean() : Promise.resolve([]),
    Promise.all(accounts.map(account => getRingCentralDirectorySnapshotModel().findOne({ provider_account_id: account }).select("provider_account_id taken_at extensions queues").sort({ taken_at: -1 }).lean())),
    routeIds.length || numberVariants.length ? getRingCentralInboundRouteModel().find({ $or: [...(routeIds.length ? [{ _id: { $in: routeIds.map(id => new mongoose.Types.ObjectId(id)) } }] : []),
      ...(numberVariants.length ? [{ phone_number: { $in: numberVariants } }] : [])] }).select("phone_number display_label ringcentral_queue_name").limit(100).lean() : Promise.resolve([]),
  ]);
  const wanted = new Set(extensions);
  return {
    links: (links as unknown as Array<Record<string, unknown>>).map(l => ({ id: String(l._id), revision: Number(l.revision ?? 1), agent_id: String(l.agent_id), agent_name: String(l.agent_name_snapshot ?? ""),
      rc_account_id: String(l.rc_account_id), rc_extension_id: String(l.rc_extension_id), rc_extension_number: (l.rc_extension_number as string | null) ?? null,
      rc_extension_name: (l.rc_extension_name_snapshot as string | null) ?? null, role_kind: String(l.role_kind), status: String(l.status),
      effective_from: (l.effective_from as Date).toISOString(), effective_to: l.effective_to instanceof Date ? l.effective_to.toISOString() : null,
      reviewed_at: l.reviewed_at instanceof Date ? l.reviewed_at.toISOString() : null, reviewed_by: (l.reviewed_by as string | null) ?? null }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    directories: directories.flatMap((row): CaseDirectory[] => {
      if (!row) return [];
      const snapshot = row as unknown as { provider_account_id: string; taken_at?: Date; extensions?: Array<{ id: string; name?: string | null; extension_number?: string | null }>;
        queues?: Array<{ id: string; name?: string | null; extension_number?: string | null }> };
      return [{ account_id: snapshot.provider_account_id, taken_at: snapshot.taken_at instanceof Date ? snapshot.taken_at.toISOString() : null,
        extensions: Object.fromEntries((snapshot.extensions ?? []).filter(e => wanted.has(e.id)).map(e => [e.id, { name: e.name ?? null, extension_number: e.extension_number ?? null }])),
        queues: Object.fromEntries((snapshot.queues ?? []).map(q => [q.id, { name: q.name ?? null, extension_number: q.extension_number ?? null }])) }];
    }),
    routes: (routes as unknown as Array<{ _id: unknown; phone_number?: string | null; display_label: string; ringcentral_queue_name?: string | null }>)
      .map((r): CaseRoute => ({ id: String(r._id), phone_number: r.phone_number ?? null, display_label: r.display_label, queue_name: r.ringcentral_queue_name ?? null }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    call_leads: leads.filter(l => l.ringcentral).map(l => ({ lead_ref: l.ref, telephony_session_id: l.ringcentral!.telephony_session_id, target_phone_number: l.ringcentral!.target_phone_number,
      target_name: l.ringcentral!.target_name, source_label: l.ringcentral!.source_label })),
  };
}
