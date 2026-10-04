/**
 * SLIM-01 read-only production inventory, and the generator of the SLIM-10 deletion manifest.
 *
 *   node --import tsx ops/slimming/inventory.ts [--write-manifest] [--skip-blob] [--out=<json path>]
 *
 * Reads the server `.env` (MONGO_URI, MONGO_DNS_SERVERS, BLOB_READ_WRITE_TOKEN) and the Admin `.env`
 * (MONGODB_URI, ADMIN_AUTH_DB_NAME) without printing them. Every Mongo call goes through `ReadOnlyCluster`, whose
 * driver guard exits before any non-read command is sent; Blob access is `list` only.
 *
 * Output (identifiers, field names, counts and sizes only; no document values):
 *   - `docs/server-admin-slimming/evidence/inventory.json` (or `--out`), the redacted inventory;
 *   - with `--write-manifest`: `ops/slimming/deletion-manifest.json` and `ops/slimming/conversation-blob-keys.json`.
 *
 * Cost: listCollections/$collStats/listIndexes everywhere; full `$group` scans of `sales_intelligence_jobs` and
 * `sales_intelligence_audit_events` (a few hundred MB, once); `$sample` of at most 400 documents per mixed
 * collection for field-path discovery; everything else is indexed or runs over small collections.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { type Document, ObjectId } from "mongodb";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { listBlobs, listTopLevelFolders } from "./lib/blob";
import { clusterFingerprint, hasFlag, argValue, loadSlimmingEnv, SERVER_ROOT, WORKSPACE_ROOT } from "./lib/env";
import { type CollectionInfo, type CollStats, type IndexInfo, ReadOnlyCluster } from "./lib/guarded-mongo";
import {
  BLOB_KEYS_PATH,
  type Cleanup,
  type CollectionTarget,
  type Manifest,
  MANIFEST_PATH,
  type ManifestTargets,
  assertManifestInvariants,
  canonicalJson,
  manifestHash,
  sha256,
} from "./lib/manifest";
import {
  ADMIN_AUTH_DATABASE,
  ADMIN_DROP_COLLECTIONS,
  ADMIN_NEVER_DROP,
  CLEANUP_STATUS,
  CONTACT_NUMBER_DEAD_FIELDS,
  CONTACT_NUMBER_REVIEW_FIELDS,
  CONVERSATION_BLOB_PREFIX,
  HISTORICAL_DATABASE,
  LEGACY_JOB_STAGES,
  MAIN_CLASSIFICATION,
  MAIN_DATABASE,
  MAIN_DROP_COLLECTIONS,
  KEPT_SYNC_SCOPE_FAMILY,
  KEPT_SYNC_SCOPES,
  NEVER_DROP,
  PENDING_SYNC_SCOPES,
  RETIRED_AUDIT_ACTOR_KINDS,
  RETIRED_AUDIT_EVENT_KINDS,
  RETIRED_JOB_REASON,
  RETIRED_SYNC_SCOPES,
  SPLIT_JOB_STAGES,
} from "./policy";

const RETIRED_AUDIT_FILTER = {
  event_kind: { $in: [...RETIRED_AUDIT_EVENT_KINDS] },
  "actor.kind": { $in: [...RETIRED_AUDIT_ACTOR_KINDS] },
};

function syncScopeClass(scope: string): "retired" | "pending_wave3" | "keep" | "unknown" {
  if ((RETIRED_SYNC_SCOPES as readonly string[]).includes(scope)) return "retired";
  if ((PENDING_SYNC_SCOPES as readonly string[]).includes(scope)) return "pending_wave3";
  if ((KEPT_SYNC_SCOPES as readonly string[]).includes(scope) || scope.startsWith(KEPT_SYNC_SCOPE_FAMILY)) return "keep";
  return "unknown";
}

const SYSTEM_DATABASES = new Set(["admin", "local", "config"]);
/** Field paths whose names mark AI, outreach, summary, schedule or assessment content. */
const AI_PATH = /summary|schedule|analy|outreach|assessment|intelligence|attention|transcri|conversation|finding|run_id|purge|retention|evidence|ai_|llm|model|story|band/i;

type NamespaceRow = {
  db: string;
  name: string;
  type: string;
  uuid: string | null;
  decision: string;
  owner: string;
  reason: string;
  stats: CollStats | null;
  indexes: IndexInfo[];
  id_range: { first: string | null; last: string | null } | null;
};

const git = (cwd: string, args: string[]) => {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
};

const log = (line: string) => process.stdout.write(`${line}\n`);
const tally = (rows: Document[]) => rows.map(({ _id, ...rest }) => ({ ...(_id as Document), ...rest }));

async function idRange(c: ReadOnlyCluster, db: string, name: string): Promise<{ first: string | null; last: string | null }> {
  const at = async (dir: 1 | -1) => {
    const [row] = await c.find(db, name, {}, { projection: { _id: 1 }, sort: { _id: dir }, limit: 1 });
    return row?._id instanceof ObjectId ? row._id.getTimestamp().toISOString() : null;
  };
  return { first: await at(1), last: await at(-1) };
}

async function describeNamespaces(
  c: ReadOnlyCluster,
  db: string,
  classify: (name: string) => { decision: string; owner: string; reason: string },
  withRanges: (name: string) => boolean,
): Promise<NamespaceRow[]> {
  const rows: NamespaceRow[] = [];
  for (const info of await c.listCollections(db)) {
    const cls = classify(info.name);
    const isCollection = info.type === "collection";
    rows.push({
      db,
      name: info.name,
      type: info.type,
      uuid: info.uuid,
      ...cls,
      stats: isCollection ? await c.collStats(db, info.name) : null,
      indexes: isCollection ? await c.indexes(db, info.name) : [],
      id_range: isCollection && withRanges(info.name) ? await idRange(c, db, info.name) : null,
    });
  }
  return rows;
}

/** Field paths (no values) over a `$sample`, with per-path sample frequency. Arrays are walked through as `[]`. */
async function samplePaths(c: ReadOnlyCluster, db: string, name: string, size = 400): Promise<{ sampled: number; paths: Record<string, number> }> {
  const docs = await c.aggregate(db, name, [{ $sample: { size } }]);
  const paths: Record<string, number> = {};
  const walk = (value: unknown, prefix: string, seen: Set<string>, depth: number) => {
    if (depth > 4 || value === null || typeof value !== "object" || value instanceof Date || value instanceof ObjectId) return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 20)) walk(item, `${prefix}[]`, seen, depth + 1);
      return;
    }
    if ((value as { _bsontype?: string })._bsontype) return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (!seen.has(path)) {
        seen.add(path);
        paths[path] = (paths[path] ?? 0) + 1;
      }
      walk(child, path, seen, depth + 1);
    }
  };
  for (const doc of docs) walk(doc, "", new Set(), 0);
  return { sampled: docs.length, paths };
}

async function existsCounts(c: ReadOnlyCluster, db: string, name: string, paths: readonly string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const path of paths) {
    if (path.includes("[]")) continue;
    out[path] = await c.count(db, name, { [path]: { $exists: true } });
  }
  return out;
}

async function nonNullCounts(c: ReadOnlyCluster, db: string, name: string, paths: readonly string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const path of paths) out[path] = await c.count(db, name, { [path]: { $exists: true, $nin: [null, []] } });
  return out;
}

/** Kind/review state of the findings behind contact restrictions (the reason the restriction exists). */
async function restrictionFindingKinds(c: ReadOnlyCluster): Promise<Document[]> {
  const rows = await c.find(MAIN_DATABASE, "sales_intelligence_contact_restrictions", { finding_id: { $type: "objectId" } }, { projection: { finding_id: 1 }, limit: 1_000 });
  const ids = rows.map((r) => r.finding_id as ObjectId);
  if (!ids.length) return [];
  const found = await c.find(MAIN_DATABASE, "intelligence_findings", { _id: { $in: ids } }, { projection: { kind: 1, review_state: 1 }, limit: 1_000 });
  const tallyBy = new Map<string, number>();
  for (const f of found) tallyBy.set(`${f.kind}|${f.review_state}`, (tallyBy.get(`${f.kind}|${f.review_state}`) ?? 0) + 1);
  const kinds: Document[] = [...tallyBy].map(([key, count]) => ({ kind: key.split("|")[0], review_state: key.split("|")[1], count }));
  return [...kinds, { kind: "(finding missing)", review_state: null, count: ids.length - found.length }];
}

const group = (c: ReadOnlyCluster, db: string, name: string, keys: Record<string, string>, extra: Document = {}) =>
  c.aggregate(db, name, [{ $group: { _id: keys, count: { $sum: 1 }, ...extra } }, { $sort: { count: -1 } }]).then(tally);

async function main(): Promise<void> {
  const argv = process.argv;
  const env = loadSlimmingEnv(argv);
  const observedAt = new Date().toISOString();
  const runtimeDb = withProductionRuntime(() => getMongoDatabaseName());
  if (runtimeDb !== MAIN_DATABASE) throw new Error(`runtime database resolves to ${runtimeDb}, policy expects ${MAIN_DATABASE}`);
  if (env.adminAuthDbName && env.adminAuthDbName !== ADMIN_AUTH_DATABASE)
    throw new Error(`ADMIN_AUTH_DB_NAME is ${env.adminAuthDbName}, policy expects ${ADMIN_AUTH_DATABASE}`);
  const fingerprint = clusterFingerprint(env.serverMongoUri);
  const adminSameCluster = env.adminMongoUri ? clusterFingerprint(env.adminMongoUri) === fingerprint : null;
  if (adminSameCluster === false) throw new Error("the Admin auth DB is on a different cluster; extend the inventory before relying on it");

  const c = await ReadOnlyCluster.connect(env.serverMongoUri, env);
  try {
    log(`[inventory] observed_at=${observedAt} cluster=${fingerprint}`);
    const replicaSet = await c.replicaSetName();
    const databases = await c.listDatabases();

    // 1. Namespaces: the three in-scope databases in full; any other database by name, count and size.
    const main = await describeNamespaces(
      c,
      MAIN_DATABASE,
      (name) => MAIN_CLASSIFICATION[name] ?? { decision: "unknown", owner: "no reader/writer found in workspace source", reason: "Protected until classified (DATA §1.2)" },
      (name) => MAIN_CLASSIFICATION[name]?.decision !== "keep",
    );
    log(`[inventory] ${MAIN_DATABASE}: ${main.length} namespaces`);
    const historical = databases.some((d) => d.name === HISTORICAL_DATABASE)
      ? await describeNamespaces(c, HISTORICAL_DATABASE, () => ({ decision: "drop", owner: "src/models/historical/*", reason: "SPEC §3: whole database" }), () => true)
      : [];
    const adminAuth = databases.some((d) => d.name === ADMIN_AUTH_DATABASE)
      ? await describeNamespaces(
          c,
          ADMIN_AUTH_DATABASE,
          (name) =>
            ADMIN_DROP_COLLECTIONS[name]
              ? { decision: "drop", owner: ADMIN_DROP_COLLECTIONS[name]!.owner, reason: `SPEC ${ADMIN_DROP_COLLECTIONS[name]!.spec}` }
              : (ADMIN_NEVER_DROP as readonly string[]).includes(name)
                ? { decision: "keep", owner: "vantage-admin auth", reason: "Admin auth, sessions and invites (SPEC §6)" }
                : { decision: "unknown", owner: "unclassified", reason: "Protected until classified" },
          (name) => Boolean(ADMIN_DROP_COLLECTIONS[name]),
        )
      : [];
    const otherDatabases = [];
    for (const d of databases) {
      if (SYSTEM_DATABASES.has(d.name) || [MAIN_DATABASE, HISTORICAL_DATABASE, ADMIN_AUTH_DATABASE].includes(d.name)) continue;
      const cols = await c.listCollections(d.name);
      let docs = 0;
      for (const col of cols) if (col.type === "collection") docs += (await c.collStats(d.name, col.name)).count;
      otherDatabases.push({ name: d.name, size_on_disk: d.sizeOnDisk, collections: cols.length, documents: docs, decision: "unknown", reason: "Out of slimming scope; not a target" });
    }

    // 2. Shared SI jobs: stage × status, lease state, payload markers.
    log("[inventory] sales_intelligence_jobs breakdown");
    const now = new Date();
    const jobsByStageStatus = await group(c, MAIN_DATABASE, "sales_intelligence_jobs", { stage: "$stage", status: "$status" }, {
      first_id: { $min: "$_id" },
      last_id: { $max: "$_id" },
      bytes: { $sum: { $bsonSize: "$$ROOT" } },
    }).then((rows) =>
      rows.map((r) => ({
        ...r,
        first_id: r.first_id instanceof ObjectId ? r.first_id.getTimestamp().toISOString() : null,
        last_id: r.last_id instanceof ObjectId ? r.last_id.getTimestamp().toISOString() : null,
        legacy: (LEGACY_JOB_STAGES as readonly string[]).includes(String(r.stage)),
        split: (SPLIT_JOB_STAGES as readonly string[]).includes(String(r.stage)),
      })),
    );
    const legacyStages = [...LEGACY_JOB_STAGES];
    const jobs = {
      by_stage_status: jobsByStageStatus,
      legacy_live_leases: await c.count(MAIN_DATABASE, "sales_intelligence_jobs", { stage: { $in: legacyStages }, status: "leased", leased_until: { $gt: now } }),
      legacy_expired_leases: await c.count(MAIN_DATABASE, "sales_intelligence_jobs", { stage: { $in: legacyStages }, status: "leased", $or: [{ leased_until: { $lte: now } }, { leased_until: null }] }),
      legacy_runnable: await c.count(MAIN_DATABASE, "sales_intelligence_jobs", { stage: { $in: legacyStages }, status: { $in: ["pending", "retry", "paused"] } }),
      owner_reanalysis_rows: await c.count(MAIN_DATABASE, "sales_intelligence_jobs", { owner_reanalysis: { $nin: [null] } }),
      completed_without_completed_at: await c.count(MAIN_DATABASE, "sales_intelligence_jobs", { status: "completed", completed_at: null }),
    };

    // 3. Sync state rows: scope identity, field names and lease state only.
    const syncRows = await c.find(MAIN_DATABASE, "sales_intelligence_sync_state", {}, { limit: 1_000, sort: { _id: 1 } });
    const syncState = syncRows.map((row) => {
      const scope = String(row.scope);
      return {
        scope,
        class: syncScopeClass(scope),
        fields: Object.keys(row).filter((k) => k !== "_id").sort(),
        cursor_fields: row.cursor && typeof row.cursor === "object" ? Object.keys(row.cursor).sort() : [],
        lease_live: row.leased_until instanceof Date && row.leased_until > now,
        updated_at: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : null,
      };
    });

    // 4. Field-path discovery on retained/mixed documents; `$exists` counts for AI-marked paths.
    log("[inventory] field-path discovery");
    const discovery: Record<string, unknown> = {};
    for (const name of [
      "contact_numbers",
      "call_interactions",
      "call_interaction_aliases",
      "number_lead_attachments",
      "rep_identity_links",
      "sales_intelligence_jobs",
      "sales_intelligence_review_items",
      "sales_intelligence_owner_instructions",
      "sales_intelligence_contact_restrictions",
      "owner_rep_nudges",
      "sales_intelligence_command_executions",
      "sales_intelligence_policy_versions",
      "form_leads",
      "call_leads",
      "booked_leads",
      "cancelled_leads",
      "customers",
      "agents",
    ]) {
      if (!main.some((n) => n.name === name)) continue;
      const { sampled, paths } = await samplePaths(c, MAIN_DATABASE, name);
      const flagged = Object.keys(paths).filter((p) => AI_PATH.test(p)).sort();
      const required = name === "contact_numbers" ? [...CONTACT_NUMBER_DEAD_FIELDS, ...CONTACT_NUMBER_REVIEW_FIELDS] : [];
      discovery[name] = {
        sampled,
        all_paths: name === "contact_numbers" ? Object.keys(paths).sort() : undefined,
        flagged_paths: flagged,
        exists_counts: await existsCounts(c, MAIN_DATABASE, name, [...new Set([...flagged, ...required])].sort()),
        non_null_counts: await nonNullCounts(c, MAIN_DATABASE, name, [...new Set([...flagged, ...required])].filter((p) => !p.includes("[]")).sort()),
      };
    }
    const contactNumbersDeadMatches = await c.count(MAIN_DATABASE, "contact_numbers", { $or: CONTACT_NUMBER_DEAD_FIELDS.map((f) => ({ [f]: { $exists: true } })) });
    const contactNumbersReviewMatches = await c.count(MAIN_DATABASE, "contact_numbers", { $or: CONTACT_NUMBER_REVIEW_FIELDS.map((f) => ({ [f]: { $exists: true } })) });

    // 5. Human/provider facts and their provenance.
    log("[inventory] human facts");
    const humanFacts = {
      contact_restrictions: {
        by_origin_state_actor: await group(c, MAIN_DATABASE, "sales_intelligence_contact_restrictions", { origin: "$origin", state: "$state", actor: "$actor.kind" }),
        active_unexpired: await c.count(MAIN_DATABASE, "sales_intelligence_contact_restrictions", { state: "active", $or: [{ until: null }, { until: { $gt: now } }] }),
        refs: await nonNullCounts(c, MAIN_DATABASE, "sales_intelligence_contact_restrictions", ["run_id", "finding_id", "source_interaction_id"]),
        source_findings: await restrictionFindingKinds(c),
      },
      owner_instructions: {
        by_field_state_actor: await group(c, MAIN_DATABASE, "sales_intelligence_owner_instructions", { field: "$field", state: "$state", actor: "$actor.kind" }),
        refs: await nonNullCounts(c, MAIN_DATABASE, "sales_intelligence_owner_instructions", ["followup_id", "finding_id"]),
      },
      review_items: {
        by_cause_state: await group(c, MAIN_DATABASE, "sales_intelligence_review_items", { cause: "$cause_kind", state: "$state", resolver: "$resolution_actor.kind" }),
        refs: await nonNullCounts(c, MAIN_DATABASE, "sales_intelligence_review_items", ["evidence_ids"]),
      },
      owner_rep_nudges: {
        by_purpose_status_channel: await group(c, MAIN_DATABASE, "owner_rep_nudges", { purpose: "$purpose", status: "$status", channel: "$channel" }),
        refs: await nonNullCounts(c, MAIN_DATABASE, "owner_rep_nudges", ["outreach_record_id", "contact_number_id", "rep_identity_link_id", "agent_id"]),
      },
      outreach_followups: {
        by_origin_status_requested: await group(c, MAIN_DATABASE, "outreach_followups", { origin: "$origin", status: "$status", requested_by: "$requested_by" }),
        by_assignment_origin: await group(c, MAIN_DATABASE, "outreach_followups", { assignment_origin: "$assignment.origin", status: "$status" }),
        open_due_future: await c.count(MAIN_DATABASE, "outreach_followups", { status: "open", due_at: { $gt: now } }),
        refs: await nonNullCounts(c, MAIN_DATABASE, "outreach_followups", ["owner_instruction_ids", "source_finding_ids", "origin_run_id"]),
      },
      outreach_records: {
        by_state_assignment: await group(c, MAIN_DATABASE, "outreach_records", { state: "$state", assignment_origin: "$assignment.origin" }),
      },
      number_lead_attachments: {
        by_state_certainty: await group(c, MAIN_DATABASE, "number_lead_attachments", { state: "$state", certainty: "$certainty" }),
        refs: await nonNullCounts(c, MAIN_DATABASE, "number_lead_attachments", ["decided_by", "auto_decision"]),
      },
      rep_identity_links: { count: await c.count(MAIN_DATABASE, "rep_identity_links") },
    };

    // 6. Mixed audit/command/policy breakdowns (bytes via $bsonSize).
    log("[inventory] audit/command/policy breakdowns");
    const auditEvents = await group(c, MAIN_DATABASE, "sales_intelligence_audit_events", { event_kind: "$event_kind", invalidation_kind: "$invalidation.kind", actor: "$actor.kind" }, {
      bytes: { $sum: { $bsonSize: "$$ROOT" } },
      first: { $min: "$happened_at" },
      last: { $max: "$happened_at" },
    });
    const auditRetiredMatches = await c.count(MAIN_DATABASE, "sales_intelligence_audit_events", RETIRED_AUDIT_FILTER);
    const unclassifiedAuditKinds = auditEvents
      .map((r) => String(r.event_kind))
      .filter((kind, i, all) => all.indexOf(kind) === i && !(RETIRED_AUDIT_EVENT_KINDS as readonly string[]).includes(kind));
    const commandExecutions = await group(c, MAIN_DATABASE, "sales_intelligence_command_executions", { command: "$command", actor: "$actor.kind" }, { bytes: { $sum: { $bsonSize: "$$ROOT" } } });
    const policyVersions = (await c.find(MAIN_DATABASE, "sales_intelligence_policy_versions", {}, { projection: { version: 1, effective_at: 1, "actor.kind": 1 }, sort: { effective_at: 1 }, limit: 100 })).map((r) => ({
      version: r.version,
      effective_at: r.effective_at instanceof Date ? r.effective_at.toISOString() : null,
      actor: r.actor?.kind ?? null,
    }));
    const policyPointers = (await c.find(MAIN_DATABASE, "sales_intelligence_policy_pointers", {}, { projection: { key: 1, version: 1 }, limit: 10 })).map((r) => ({ key: r.key, version: r.version }));
    const auditRefs = await nonNullCounts(c, MAIN_DATABASE, "sales_intelligence_audit_events", ["run_id"]);
    const contactNumberRefs = await nonNullCounts(c, MAIN_DATABASE, "contact_numbers", ["running_summary.run_id", "intelligence_schedule.job_id", "contact_eligibility.evidence_ref"]);

    // 7. Lead Conversations media references and the Blob store.
    log("[inventory] conversation media references");
    const conversationRefs = (await c.distinct(MAIN_DATABASE, "lead_conversations", "media.blob_pathname", { "media.blob_pathname": { $type: "string" } })).map(String);
    // Superseded audio a completed media_fetch job handed to the (now removed) retention Blob delete; these keys
    // need not appear in lead_conversations any more, so the manifest takes the union.
    const pendingDeleteRefs = (
      await c.distinct(MAIN_DATABASE, "sales_intelligence_jobs", "result.pending_blob_delete", {
        stage: "media_fetch",
        status: "completed",
        "result.pending_blob_delete": { $type: "string" },
      })
    ).map(String);
    const mediaRefs = [...new Set([...conversationRefs, ...pendingDeleteRefs])];
    const conversationMedia = {
      docs: await c.count(MAIN_DATABASE, "lead_conversations"),
      with_blob_pathname: await c.count(MAIN_DATABASE, "lead_conversations", { "media.blob_pathname": { $type: "string" } }),
      with_media_purged_at: await c.count(MAIN_DATABASE, "lead_conversations", { "media.purged_at": { $type: "date" } }),
      distinct_pathnames: mediaRefs.length,
      pending_blob_delete_pathnames: pendingDeleteRefs.length,
      pathnames_outside_prefix: mediaRefs.filter((p) => !p.startsWith(CONVERSATION_BLOB_PREFIX)).length,
    };
    let blob: Document | null = null;
    let blobKeys: string[] = [];
    if (hasFlag(argv, "skip-blob")) blob = { skipped: "--skip-blob" };
    else if (!env.blobToken) blob = { skipped: "BLOB_READ_WRITE_TOKEN not set" };
    else {
      log("[inventory] Blob list (read-only)");
      const objects = await listBlobs(env.blobToken, CONVERSATION_BLOB_PREFIX);
      const folders = await listTopLevelFolders(env.blobToken);
      const referenced = new Set(mediaRefs);
      const present = new Set(objects.map((o) => o.pathname));
      const candidates = objects.filter((o) => referenced.has(o.pathname));
      const unreferenced = objects.filter((o) => !referenced.has(o.pathname));
      blobKeys = candidates.map((o) => o.pathname);
      const dates = objects.map((o) => o.uploadedAt).sort();
      blob = {
        store_top_level_folders: folders.folders,
        store_root_objects: folders.rootObjects,
        prefix: CONVERSATION_BLOB_PREFIX,
        objects: objects.length,
        bytes: objects.reduce((s, o) => s + o.size, 0),
        uploaded_first: dates[0] ?? null,
        uploaded_last: dates.at(-1) ?? null,
        referenced_and_present: candidates.length,
        referenced_and_present_bytes: candidates.reduce((s, o) => s + o.size, 0),
        referenced_but_missing: [...referenced].filter((p) => !present.has(p)).length,
        unreferenced_under_prefix: unreferenced.length,
        unreferenced_bytes: unreferenced.reduce((s, o) => s + o.size, 0),
      };
    }

    const inventory = {
      version: "slimming-inventory-v1",
      observed_at: observedAt,
      cluster: { fingerprint, replica_set: replicaSet, admin_auth_same_cluster: adminSameCluster },
      source: {
        server_head: git(SERVER_ROOT, ["rev-parse", "HEAD"]),
        server_branch: git(SERVER_ROOT, ["rev-parse", "--abbrev-ref", "HEAD"]),
        admin_head: git(resolve(WORKSPACE_ROOT, "vantage-admin"), ["rev-parse", "HEAD"]),
      },
      runtime_database: runtimeDb,
      admin_auth_database: env.adminAuthDbName,
      databases,
      namespaces: { [MAIN_DATABASE]: main, [HISTORICAL_DATABASE]: historical, [ADMIN_AUTH_DATABASE]: adminAuth },
      other_databases: otherDatabases,
      jobs,
      sync_state: syncState,
      field_discovery: discovery,
      contact_numbers_cleanup: { dead_field_matches: contactNumbersDeadMatches, review_field_matches: contactNumbersReviewMatches },
      human_facts: humanFacts,
      audit_events: {
        by_kind: auditEvents,
        retired_filter: RETIRED_AUDIT_FILTER,
        retired_matches: auditRetiredMatches,
        retired_bytes: auditEvents
          .filter((r) => (RETIRED_AUDIT_EVENT_KINDS as readonly string[]).includes(String(r.event_kind)) && (RETIRED_AUDIT_ACTOR_KINDS as readonly string[]).includes(String(r.actor)))
          .reduce((sum, r) => sum + Number(r.bytes), 0),
        kept_kinds: unclassifiedAuditKinds,
        refs: auditRefs,
      },
      command_executions: commandExecutions,
      policy: { versions: policyVersions, pointers: policyPointers },
      reference_edges: { contact_numbers: contactNumberRefs },
      conversation_media: conversationMedia,
      blob,
    };
    const out = argValue(argv, "out") ?? resolve(SERVER_ROOT, "docs/server-admin-slimming/evidence/inventory.json");
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(inventory, null, 2)}\n`);
    log(`[inventory] wrote ${out}`);

    if (hasFlag(argv, "write-manifest")) {
      const manifest = buildManifest({ observedAt, fingerprint, replicaSet, main, historical, adminAuth, jobsByStageStatus, syncState, contactNumbersDeadMatches, contactNumbersReviewMatches, auditRetiredMatches, blobKeys, blob, source: inventory.source, databases });
      writeFileSync(BLOB_KEYS_PATH, `${JSON.stringify(blobKeys, null, 1)}\n`);
      writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
      log(`[inventory] wrote ${MANIFEST_PATH}`);
      log(`[inventory] manifest_hash=${manifest.manifest_hash}`);
    }
  } finally {
    await c.close();
  }
}

/** Resolves the runtime database name as a production deployment would (TEST_MODE unset). */
function withProductionRuntime<T>(fn: () => T): T {
  const saved = process.env.TEST_MODE;
  delete process.env.TEST_MODE;
  try {
    return fn();
  } finally {
    if (saved !== undefined) process.env.TEST_MODE = saved;
  }
}

type BuildInput = {
  observedAt: string;
  fingerprint: string;
  replicaSet: string | null;
  main: NamespaceRow[];
  historical: NamespaceRow[];
  adminAuth: NamespaceRow[];
  jobsByStageStatus: Array<Document>;
  syncState: Array<{ scope: string; class: string }>;
  contactNumbersDeadMatches: number;
  contactNumbersReviewMatches: number;
  auditRetiredMatches: number;
  blobKeys: string[];
  blob: Document | null;
  source: Manifest["source"];
  databases: Array<{ name: string; sizeOnDisk: number }>;
};

function collectionTarget(row: NamespaceRow, spec: { spec: string; owner: string; gate: string }): CollectionTarget {
  if (!row.uuid || !row.stats) throw new Error(`${row.db}.${row.name} has no UUID/stats`);
  return {
    db: row.db,
    name: row.name,
    uuid: row.uuid,
    count: row.stats.count,
    size: row.stats.size,
    storage_size: row.stats.storageSize,
    index_size: row.stats.totalIndexSize,
    ttl: row.indexes.some((i) => i.expireAfterSeconds !== null),
    ...spec,
  };
}

function buildManifest(input: BuildInput): Manifest {
  const dropCollections: CollectionTarget[] = [];
  const absent: ManifestTargets["absent_targets"] = [];
  for (const [name, spec] of Object.entries(MAIN_DROP_COLLECTIONS)) {
    const row = input.main.find((r) => r.name === name);
    if (row) dropCollections.push(collectionTarget(row, spec));
    else absent.push({ db: MAIN_DATABASE, name, spec: spec.spec });
  }
  for (const [name, spec] of Object.entries(ADMIN_DROP_COLLECTIONS)) {
    const row = input.adminAuth.find((r) => r.name === name);
    if (row) dropCollections.push(collectionTarget(row, spec));
    else absent.push({ db: ADMIN_AUTH_DATABASE, name, spec: spec.spec });
  }
  const historicalSize = input.databases.find((d) => d.name === HISTORICAL_DATABASE)?.sizeOnDisk ?? 0;
  const dropDatabases = input.historical.length
    ? [
        {
          name: HISTORICAL_DATABASE,
          spec: "§3",
          gate: "SLIM-03 deployed: zero useDb('vantagemovershistorical') readers/writers; separate verified backup",
          size_on_disk: historicalSize,
          collections: input.historical.map((r) => {
            if (!r.uuid) throw new Error(`${r.db}.${r.name} has no UUID`);
            return { name: r.name, uuid: r.uuid, count: r.stats?.count ?? 0 };
          }),
        },
      ]
    : [];

  const legacy = new Set<string>(LEGACY_JOB_STAGES);
  const expectedByStatus: Record<string, number> = {};
  for (const row of input.jobsByStageStatus) {
    if (!legacy.has(String(row.stage))) continue;
    expectedByStatus[String(row.status)] = (expectedByStatus[String(row.status)] ?? 0) + Number(row.count);
  }
  const presentScopes = (list: readonly string[]) => list.filter((scope) => input.syncState.some((s) => s.scope === scope)).sort();
  const retiredScopes = presentScopes(RETIRED_SYNC_SCOPES);
  const pendingScopes = presentScopes(PENDING_SYNC_SCOPES);
  const cleanups: Cleanup[] = [
    {
      id: "C1-contact-numbers-dead-fields",
      kind: "unset_fields",
      db: MAIN_DATABASE,
      collection: "contact_numbers",
      fields: [...CONTACT_NUMBER_DEAD_FIELDS],
      expected_matches: input.contactNumbersDeadMatches,
      status: CLEANUP_STATUS["C1-contact-numbers-dead-fields"],
      spec: "SPEC §7.4, DATA §1.3",
    },
    {
      id: "C2-legacy-stage-jobs",
      kind: "retire_jobs",
      db: MAIN_DATABASE,
      collection: "sales_intelligence_jobs",
      stages: [...LEGACY_JOB_STAGES],
      expected_by_status: expectedByStatus,
      reason: RETIRED_JOB_REASON,
      status: CLEANUP_STATUS["C2-legacy-stage-jobs"],
      spec: "SPEC §7.3/§7.4, DATA §1.3",
    },
    {
      id: "C3-retired-sync-scopes",
      kind: "delete_exact",
      db: MAIN_DATABASE,
      collection: "sales_intelligence_sync_state",
      key_field: "scope",
      key_values: retiredScopes,
      expected_matches: retiredScopes.length,
      status: CLEANUP_STATUS["C3-retired-sync-scopes"],
      spec: "CODE-MAP §7.1, SPEC §7.4",
    },
    {
      id: "C6-outreach-cursor-sync-scopes",
      kind: "delete_exact",
      db: MAIN_DATABASE,
      collection: "sales_intelligence_sync_state",
      key_field: "scope",
      key_values: pendingScopes,
      expected_matches: pendingScopes.length,
      status: CLEANUP_STATUS["C6-outreach-cursor-sync-scopes"],
      spec: "SPEC §7.4 (watermark backstop moves to the independent nomination path)",
    },
    {
      id: "C4-retired-audit-events",
      kind: "delete_filter",
      db: MAIN_DATABASE,
      collection: "sales_intelligence_audit_events",
      filter: RETIRED_AUDIT_FILTER,
      expected_matches: input.auditRetiredMatches,
      status: CLEANUP_STATUS["C4-retired-audit-events"],
      spec: "SPEC §6 (legacy AI audit payloads), §7.3",
    },
    {
      id: "C5-contact-numbers-retention-fields",
      kind: "unset_fields",
      db: MAIN_DATABASE,
      collection: "contact_numbers",
      fields: [...CONTACT_NUMBER_REVIEW_FIELDS],
      expected_matches: input.contactNumbersReviewMatches,
      status: CLEANUP_STATUS["C5-contact-numbers-retention-fields"],
      spec: "SPEC §7.4",
    },
  ];

  const protectedRows: ManifestTargets["protected"] = [];
  for (const name of NEVER_DROP) {
    const row = input.main.find((r) => r.name === name);
    protectedRows.push({ db: MAIN_DATABASE, name, uuid: row?.uuid ?? null, count: row?.stats?.count ?? 0 });
  }
  for (const name of ADMIN_NEVER_DROP) {
    const row = input.adminAuth.find((r) => r.name === name);
    protectedRows.push({ db: ADMIN_AUTH_DATABASE, name, uuid: row?.uuid ?? null, count: row?.stats?.count ?? 0 });
  }

  const blobTarget =
    input.blob && typeof input.blob.objects === "number"
      ? {
          prefix: CONVERSATION_BLOB_PREFIX,
          keys_file: "ops/slimming/conversation-blob-keys.json",
          keys_sha256: sha256(canonicalJson(input.blobKeys)),
          count: input.blobKeys.length,
          bytes: Number(input.blob.referenced_and_present_bytes ?? 0),
          unreferenced_count: Number(input.blob.unreferenced_under_prefix ?? 0),
        }
      : null;

  const targets: ManifestTargets = {
    cluster: { fingerprint: input.fingerprint, replica_set: input.replicaSet },
    main_database: MAIN_DATABASE,
    admin_auth_database: ADMIN_AUTH_DATABASE,
    drop_databases: dropDatabases,
    drop_collections: dropCollections,
    absent_targets: absent,
    cleanups,
    blob: blobTarget,
    protected: protectedRows,
  };
  assertManifestInvariants(targets);
  return {
    version: "slimming-deletion-manifest-v1",
    generated_at: input.observedAt,
    source: input.source,
    manifest_hash: manifestHash(targets),
    targets,
  };
}

main().catch((error: unknown) => {
  process.stderr.write(`[inventory] failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}\n`);
  process.exit(1);
});
