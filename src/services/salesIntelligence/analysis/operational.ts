import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { z } from "zod";
import { csiDataset, csiFlag } from "../../../config/domain/salesIntelligence";
import { getMongoDatabaseName } from "../../../config/domain/runtime";
import { toObjectId } from "../../../utils/objectId";
import { getGranotCrmSourceModel } from "../../../models/GranotCrmSource";
import { getRingCentralDirectorySnapshotModel } from "../../../models/RingCentralDirectorySnapshot";
import { getCallInteractionModel } from "../../../models/CallInteraction";
import { getCallInteractionAliasModel } from "../../../models/CallInteractionAlias";
import { getIntelligenceEvidenceSnapshotModel } from "../../../models/IntelligenceEvidenceSnapshot";
import { getCatalogItem } from "../../catalog/catalog.service";
import { getRegistryGranotCrmSource } from "../../operationsRegistry/granotCrmSources";
import { createJobNumberTimelineModule } from "../../jobNumberTimeline/module";
import { createMongoEvidenceLoader, JobTimelineEvidenceLimitError } from "../../jobNumberTimeline/mongo-evidence-loader";
import type { EnhancedJobTimelinePage } from "../../jobNumberTimeline/types";
import { redactTranscript } from "../../conversations/redaction";
import { normalizePhoneNumberToE164Like } from "../../ringcentral/phone-normalization";
import { getRingCentralTokenStore } from "../../ringcentral/auth";
import { acquireRingCentralSlot, providerRetryAfterMs, recordRingCentralThrottle, RingCentralGateDeniedError, type RingCentralRateGate } from "../../ringcentral/rateLimitGate";
import { resolveRepIdentities } from "../repIdentity/resolve";
import type { RingCentralTokenCache } from "../../ringcentral/types";
import { CsiError } from "../auth";
import { intelligenceReadSchema, readPageSchema, type EvidenceRecord, type IntelligenceRead, type ReadPage, type ReadScope } from "./contracts";
import { readLeads, readBookings, readCancellations } from "./reads";

type OperationalInput = Extract<IntelligenceRead, { tool: "query_operational_records" | "search_ringcentral_calls" | "get_ringcentral_call" }>;
type DatasetInput = Extract<OperationalInput, {tool: "query_operational_records"}>["args"];
type OperationalDeps = {
  load?: (scope: ReadScope, dataset: DatasetInput["dataset"]) => Promise<ReadPage>;
  providerGet?: (path: string) => Promise<unknown>;
  providerEnabled?: boolean;
  admittedCall?: (scope: ReadScope, id: string) => Promise<boolean>;
};
const empty = (reason: string): ReadPage => ({records: [], next_cursor: null, complete: false, missing_ranges: [reason]});
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const safeText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const redacted = redactTranscript(value).text;
  if (redacted.length > 1000) throw new CsiError("BUDGET_EXHAUSTED");
  return redacted;
};
const safeDate = (value: unknown): string | null => value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

function cursorOffset(cursor: string | undefined, binding: string) {
  if (!cursor) return 0;
  try {
    const value = z.object({binding: z.literal(binding), offset: z.number().int().min(0).max(10_000)}).strict().parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
    return value.offset;
  } catch { throw new CsiError("INVALID_INPUT"); }
}
function encodeCursor(binding: string, offset: number) { return Buffer.from(JSON.stringify({ binding, offset })).toString("base64url"); }
function boundedPage(scope: ReadScope, args: DatasetInput, source: ReadPage): ReadPage {
  const query = args.query?.toLowerCase();
  const rows = source.records.filter(row => !query || [row.record_id, row.fields.name, row.fields.job_no, row.fields.source, row.fields.description].some(value => value?.toLowerCase().includes(query)));
  const binding = hash({run: scope.run_id, subject: scope.subject_key, dataset: args.dataset, query, revision: hash(rows)});
  const offset = cursorOffset(args.cursor, binding);
  const records = rows.slice(offset, offset + args.limit);
  const more = offset + records.length < rows.length;
  return readPageSchema.parse({records, next_cursor: more ? encodeCursor(binding, offset + records.length) : null, complete: !more && source.complete, missing_ranges: source.missing_ranges});
}

/** No model query document reaches Mongo: datasets, joins, projection and pagination are server-owned. */
export async function readOperationalRecords(scope: ReadScope, raw: OperationalInput, deps: OperationalDeps = {}): Promise<ReadPage> {
  const input = intelligenceReadSchema.parse(raw);
  if (input.tool === "query_operational_records") {
    const {dataset, ...args} = input.args;
    if (!deps.load && (dataset === "form_leads" || dataset === "call_leads")) return readLeads(scope, {...args, model: dataset === "form_leads" ? "FormLead" : "CallLead"});
    if (!deps.load && dataset === "bookings") return readBookings(scope, args);
    if (!deps.load && dataset === "cancellations") return readCancellations(scope, args);
    return boundedPage(scope, input.args, await (deps.load ?? loadOperationalDataset)(scope, dataset));
  }
  if (input.tool !== "search_ringcentral_calls" && input.tool !== "get_ringcentral_call") throw new CsiError("INVALID_INPUT");
  if (!(deps.providerEnabled ?? csiFlag("PROVIDER_READS"))) return empty("ringcentral_provider_reads_disabled");
  if (!scope.account_id || !/^[A-Za-z0-9_-]+$/.test(scope.account_id) || !normalizePhoneNumberToE164Like(scope.e164)) return empty("ringcentral_account_or_number_unavailable");
  const root = `/restapi/v1.0/account/${encodeURIComponent(scope.account_id)}/call-log`;
  const provider = deps.providerGet ?? createScopedRingCentralGet();
  if (input.tool === "get_ringcentral_call") {
    if (!await (deps.admittedCall ?? isAdmittedCall)(scope, input.args.call_log_id)) throw new CsiError("EVIDENCE_SCOPE_INVALID");
    try {
      const payload = await provider(`${root}/${encodeURIComponent(input.args.call_log_id)}`);
      const record = projectProviderCall(scope, payload);
      if (!record || record.record_id !== `ringcentral:${scope.account_id}:${input.args.call_log_id}`) throw new CsiError("EVIDENCE_SCOPE_INVALID");
      return {records: [record], next_cursor: null, complete: true, missing_ranges: []};
    } catch (error) { if (error instanceof CsiError) throw error; return empty("ringcentral_provider_unavailable"); }
  }
  const {from, to, limit} = input.args;
  const window = Date.parse(to) - Date.parse(from);
  if (window <= 0 || window > 31 * 86_400_000) throw new CsiError("INVALID_INPUT");
  const binding = hash({run: scope.run_id, subject: scope.subject_key, account: scope.account_id, from, to, limit});
  const page = cursorOffset(input.args.cursor, binding) + 1;
  if (page > 20) throw new CsiError("BUDGET_EXHAUSTED");
  const query = new URLSearchParams({dateFrom: from, dateTo: to, phoneNumber: scope.e164, perPage: String(limit), page: String(page), view: "Detailed"});
  try {
    const payload = z.object({records: z.array(z.unknown()).max(50), paging: z.object({page: z.number().int().positive().optional(), totalPages: z.number().int().nonnegative().optional()}).passthrough().optional()}).passthrough().parse(await provider(`${root}?${query}`));
    if (payload.records.length > limit) return empty("provider_page_bound_exceeded");
    const records = payload.records.flatMap(raw => { const row = projectProviderCall(scope, raw); const at = row?.fields.occurred_at; return row && at && Date.parse(at) >= Date.parse(from) && Date.parse(at) <= Date.parse(to) ? [row] : []; });
    const filtered = records.length !== payload.records.length;
    const providerComplete = payload.paging?.totalPages !== undefined && page >= payload.paging.totalPages;
    const more = !providerComplete && payload.records.length > 0;
    return {records, next_cursor: more && page < 20 ? encodeCursor(binding, page) : null, complete: providerComplete && !filtered, missing_ranges: [...(filtered ? ["provider_records_outside_subject_or_invalid"] : []), ...(!payload.paging ? ["provider_pagination_unknown"] : []), ...(more && page === 20 ? ["provider_page_budget_exhausted"] : [])]};
  } catch (error) { if (error instanceof CsiError) throw error; return empty("ringcentral_provider_unavailable"); }
}

const partySchema = z.object({phoneNumber: z.string().optional()}).passthrough();
function projectProviderCall(scope: ReadScope, raw: unknown): EvidenceRecord | null {
  const parsed = z.object({id: z.union([z.string(), z.number()]), from: partySchema.optional(), to: partySchema.optional(), startTime: z.string().optional(), lastModifiedTime: z.string().optional(), direction: z.string().optional(), result: z.string().optional(), duration: z.number().finite().nonnegative().optional(), legs: z.array(z.object({from: partySchema.optional(), to: partySchema.optional()}).passthrough()).max(200).optional()}).passthrough().safeParse(raw);
  if (!parsed.success) return null;
  const call = parsed.data;
  if (![call, ...(call.legs ?? [])].some(leg => [leg.from?.phoneNumber, leg.to?.phoneNumber].some(phone => normalizePhoneNumberToE164Like(phone) === scope.e164))) return null;
  const id = String(call.id);
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(id)) return null;
  const fields = {account_id: scope.account_id, phone: scope.e164, occurred_at: safeDate(call.startTime), direction: safeText(call.direction), result: safeText(call.result), duration_seconds: call.duration ?? null};
  return {record_type: "interaction", record_id: `ringcentral:${scope.account_id}:${id}`, revision: safeDate(call.lastModifiedTime) ?? hash(fields), fields};
}

/** Fixed read-only provider adapter. Reuses cached credentials without refreshing or writing the token store. */
export function createScopedRingCentralGet(deps: {fetchImpl?: typeof fetch; cachedToken?: () => Promise<RingCentralTokenCache | null>; origin?: string; gate?: RingCentralRateGate} = {}) {
  return async (path: string): Promise<unknown> => {
    if (!/^\/restapi\/v1\.0\/account\/[A-Za-z0-9_-]+\/call-log(?:\/[A-Za-z0-9_-]+|\?[^#]*)?$/.test(path)) throw new CsiError("INVALID_INPUT");
    const origin = new URL(deps.origin ?? process.env.RC_SERVER_URL ?? "https://invalid.invalid");
    if (origin.protocol !== "https:" || !["platform.ringcentral.com", "platform.devtest.ringcentral.com"].includes(origin.hostname) || origin.pathname !== "/" || origin.username || origin.password || origin.search || origin.hash) throw new Error("provider_unavailable");
    const token = await (deps.cachedToken ?? (() => getRingCentralTokenStore().get()))();
    if (!token || token.access_token_expires_at <= Date.now() + 30_000) throw new Error("provider_unavailable");
    // Model-driven Call Log reads share the Heavy budget as low-priority work: a closed gate is "unavailable", never a wait.
    try { await acquireRingCentralSlot(path, {priority: "low", gate: deps.gate}); }
    catch (error) { if (error instanceof RingCentralGateDeniedError) throw new Error("provider_unavailable"); throw error; }
    const response = await (deps.fetchImpl ?? fetch)(new URL(path, origin), {method: "GET", headers: {Authorization: `Bearer ${token.access_token}`, Accept: "application/json"}, redirect: "error", signal: AbortSignal.timeout(15_000)});
    if (response.status === 429) await recordRingCentralThrottle(path, {retryAfterMs: providerRetryAfterMs(response.headers).ms, headerGroup: response.headers.get("x-rate-limit-group"), gate: deps.gate});
    if (!response.ok) { await response.body?.cancel(); throw new Error("provider_unavailable"); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("provider_unavailable");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.byteLength; if (size > 1_000_000) { await reader.cancel(); throw new Error("provider_unavailable"); } chunks.push(item.value); }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } finally { reader.releaseLock(); }
  };
}

async function isAdmittedCall(scope: ReadScope, id: string): Promise<boolean> {
  const alias = await getCallInteractionAliasModel().findOne({provider_account_id: scope.account_id, kind: "call_log_id", value: id}).lean();
  if (alias && await getCallInteractionModel().exists({_id: alias.interaction_id, contact_number_id: scope.contact_number_id, provider_account_id: scope.account_id, merged_into_id: null})) return true;
  return Boolean(await getIntelligenceEvidenceSnapshotModel().exists({run_id: scope.run_id, subject_key: scope.subject_key, ...csiDataset(), "response.page.records": {$elemMatch: {record_type: "interaction", record_id: `ringcentral:${scope.account_id}:${id}`}}}));
}

async function loadOperationalDataset(scope: ReadScope, dataset: DatasetInput["dataset"]): Promise<ReadPage> {
  const db = mongoose.connection.useDb(getMongoDatabaseName(), {useCache: true}).db;
  if (!db) throw new Error("Mongo unavailable");
  if (dataset === "ringcentral_queues" || dataset === "ringcentral_users") {
    if (!scope.account_id) return empty("ringcentral_account_unavailable");
    const snapshot = await getRingCentralDirectorySnapshotModel().findOne({provider_account_id: scope.account_id}).sort({taken_at: -1}).lean();
    if (!snapshot) return empty("directory_snapshot_unavailable");
    const rows = dataset === "ringcentral_queues" ? snapshot.queues : snapshot.extensions.filter(item => item.type === "User");
    return {records: rows.slice(0, 200).map(item => ({record_type: dataset === "ringcentral_queues" ? "ringcentral_queue" : "ringcentral_user", record_id: `${scope.account_id}:${item.id}`, revision: snapshot.digest, fields: {account_id: scope.account_id, extension_id: item.id, name: safeText(item.name), role: dataset === "ringcentral_queues" ? "queue" : "User", occurred_at: snapshot.taken_at.toISOString(), certainty: "directory_record_not_reviewed_identity"}})), next_cursor: null, complete: false, missing_ranges: ["directory_provider_completeness_unverified", ...(rows.length > 200 ? ["directory_context_cap"] : [])]};
  }
  if (scope.lead_refs.length > 50) throw new CsiError("BUDGET_EXHAUSTED");
  const leads = (await Promise.all(["FormLead", "CallLead"].map(async model => {
    const ids = scope.lead_refs.filter(ref => ref.model === model).map(ref => toObjectId(ref.id));
    if (!ids.length) return [];
    return db.collection(model === "FormLead" ? "form_leads" : "call_leads").find({_id: {$in: ids}}).project({job_no: 1, receiver_agent: 1, source_granularity_id: 1}).limit(50).toArray();
  }))).flat();
  if (leads.length !== new Set(scope.lead_refs.map(ref => `${ref.model}:${ref.id}`)).size) return empty("authorized_lead_context_unavailable");
  if (dataset === "agents") {
    const ids = [...new Set(leads.flatMap(lead => lead.receiver_agent ? [String(lead.receiver_agent)] : []))];
    const interactions = await getCallInteractionModel().find({contact_number_id: scope.contact_number_id, merged_into_id: null}).select("provider_account_id parties started_at").sort({started_at: -1, _id: -1}).limit(51).lean();
    for (const call of interactions.slice(0, 50)) {
      const extensions = [...new Set(call.parties.flatMap(party => party.role === "user" && party.extension_id ? [party.extension_id] : []))].slice(0, 50);
      const resolved = await resolveRepIdentities(call.provider_account_id, extensions, call.started_at);
      for (const id of resolved.agent_ids) if (!ids.includes(id)) ids.push(id);
    }
    const records: EvidenceRecord[] = [];
    for (const id of ids.slice(0, 50)) {
      const item = await getCatalogItem("agents", id);
      records.push({record_type: "agent", record_id: item.id, revision: safeDate(item.updatedAt), fields: {name: safeText(item.name), role: safeText(item.role), active: item.active, certainty: "lead_receiver_not_speaker_authority"}});
    }
    const limited = ids.length > 50 || interactions.length > 50;
    return {records, next_cursor: null, complete: !limited, missing_ranges: limited ? ["agent_context_cap"] : []};
  }
  if (dataset === "granot_sources") {
    const ids = leads.flatMap(lead => lead.source_granularity_id ? [lead.source_granularity_id] : []);
    const selected = await getGranotCrmSourceModel().find({"lifecycle_routes.source_granularity_id": {$in: ids}}).select({_id: 1}).sort({_id: 1}).limit(201).lean();
    const records: EvidenceRecord[] = [];
    for (const row of selected.slice(0, 200)) {
      const item = await getRegistryGranotCrmSource(String(row._id));
      records.push({record_type: "granot_source", record_id: item.id, revision: item.lifecycle_policy_version || null, fields: {name: safeText(item.granot_label), source: safeText(item.source_company), active: item.enabled, status: safeText(item.lifecycle_disposition), description: safeText(item.lead_created_policy)}});
    }
    return {records, next_cursor: null, complete: selected.length <= 200, missing_ranges: selected.length > 200 ? ["source_context_cap"] : []};
  }
  if (dataset === "job_timeline") {
    const jobs = [...new Map(leads.flatMap(lead => typeof lead.job_no === "string" && lead.job_no ? [[`${lead.job_no}:${lead.source_granularity_id ?? ""}`, {job: lead.job_no, source: lead.source_granularity_id ? String(lead.source_granularity_id) : undefined}] as const] : [])).values()];
    const module = createJobNumberTimelineModule({loader: createMongoEvidenceLoader({db, maxRowsPerQuery: 200})});
    const records: EvidenceRecord[] = []; const missing = new Set<string>();
    for (const {job, source} of jobs.slice(0, 5)) {
      const result = await module.read({job_no: job, source_granularity_id: source}).catch(error => {
        if (error instanceof JobTimelineEvidenceLimitError) throw new CsiError("EVIDENCE_LIMIT_REACHED");
        throw error;
      });
      if (result.status !== "ok") { missing.add(`timeline_${result.status}`); continue; }
      const projected = projectScopedJobTimeline(scope, result.page, job, source);
      for (const limitation of projected.missing_ranges) missing.add(limitation);
      records.push(...projected.records);
    }
    if (jobs.length > 5 || records.length > 200) missing.add("job_timeline_context_cap");
    return {records: records.slice(0, 200), next_cursor: null, complete: missing.size === 0, missing_ranges: [...missing]};
  }
  throw new CsiError("INVALID_INPUT");
}

/** A typed Job Number alone cannot expose another Lead's chain when job labels collide. */
export function projectScopedJobTimeline(scope: ReadScope, page: Pick<EnhancedJobTimelinePage, "current" | "source" | "events" | "limitations">, job: string, source?: string): ReadPage {
  const lead = page.current.lead_ref;
  if (!lead || !scope.lead_refs.some(ref => ref.model === lead.model && ref.id === lead.id) || (source && page.source.source_granularity_id !== source)) return empty("timeline_subject_ambiguous");
  const missing = page.limitations.map(limitation => limitation.code);
  return {records: page.events.map(event => ({record_type: "job_timeline", record_id: `${job}:${event.id}`, revision: hash(event), fields: {job_no: job, occurred_at: event.time.occurred_at, status: event.status, description: safeText(event.headline), certainty: event.correlation.confidence}})), next_cursor: null, complete: missing.length === 0, missing_ranges: missing};
}
