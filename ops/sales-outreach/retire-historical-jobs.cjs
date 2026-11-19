/** Run with node --import tsx. Plan/verify are read-only on Atlas. The manifest stays in private operator storage. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { Readable } = require("node:stream");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { gzipSync, gunzipSync } = require("node:zlib");
const { BSON, MongoClient, ObjectId } = require("mongodb");
const { google } = require("googleapis");
const { createGoogleServiceAccountAuth } = require("../../src/services/googleAuth/serviceAccount");
const { finishedExecutionFields, routineJobExpiry, routineJobSubjectMatches } = require("../../src/services/salesIntelligence/routineJobExpiry");
const { canonicalJson } = require("../../src/services/durableWork/checksum");
const { contactEventId } = require("../../src/services/salesOutreach/contacts/derive");

const database = "vantagemovers";
const bucket = "vantage-mongodb-backups-496816";
const prefix = "history/sales-intelligence/v1/vantagemovers/";
const base = { database, deployment: "csi-production", status: "completed", reason: null,
  lease_owner: null, leased_until: null, record_kind: { $exists: false },
  stage: { $in: ["outreach_evaluate", "outreach_rep_day", "outreach_contact_change", "outreach_lead_change"] } };
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const [mode, folder, selector] = process.argv.slice(2);
assert.ok(["plan", "plan-leads", "plan-recent", "verify", "apply", "seal", "reconcile", "lookup"].includes(mode) && path.isAbsolute(folder));
const manifestPath = path.join(folder, "manifest.json");
const save = m => {
  fs.writeFileSync(manifestPath + ".tmp", JSON.stringify(m, null, 2));
  fs.renameSync(manifestPath + ".tmp", manifestPath);
};
const store = google.storage({ version: "v1", auth: createGoogleServiceAccountAuth(["https://www.googleapis.com/auth/devstorage.full_control"]) });
function decode(pack) {
  const bytes = gunzipSync(pack, { maxOutputLength: 16 * 1024 * 1024 });
  const rows = [];
  for (let at = 0; at < bytes.length;) {
    const length = bytes.readInt32LE(at);
    assert.ok(length >= 5 && at + length <= bytes.length);
    const raw = bytes.subarray(at, at + length);
    rows.push({ raw, doc: BSON.deserialize(raw) });
    at += length;
  }
  return rows;
}
function identity(doc, asOf, recent) {
  if (doc.reason || doc.lease_owner || doc.leased_until ||
      doc.status !== "completed" || !(doc.completed_at instanceof Date) || doc.input_refs?.length !== 1 ||
      doc.database !== database || doc.deployment !== base.deployment || !(doc.lease_epoch >= 1)) return false;
  const ref = String(doc.input_refs[0]);
  if (!/^[a-f0-9]{24}$/.test(ref)) return false;
  const expiry = routineJobExpiry(doc.stage, doc.dedupe_key, doc.result, doc.completed_at, doc.subject_key);
  if (!expiry || (+expiry > asOf) !== Boolean(recent) || doc.completed_at > asOf) return false;
  const hash = digest(canonicalJson({ database, deployment: base.deployment, stage: doc.stage, subject_key: doc.subject_key,
    input_revision: doc.input_revision, input_refs: [ref] }));
  if (hash !== doc.payload_hash) return false;
  return routineJobSubjectMatches(doc.stage, doc.dedupe_key, doc.subject_key, [ref]) &&
    (doc.stage !== "outreach_evaluate" || doc.result.subject_id === ref);
}
// Confirm the published object independently of the queue. Contact effects and their
// two downstream nominations committed together. Only the positive call revision producer qualifies.
async function backedRows(db, rows, asOf, session, recent) {
  const candidates = rows.filter(r => identity(r.doc, asOf, recent));
  const proofs = new Set();
  for (const stage of base.stage.$in) {
    const group = candidates.filter(r => r.doc.stage === stage);
    if (!group.length) continue;
    const refs = group.map(r => r.doc.input_refs[0]);
    const options = { session, projection: { _id: 1, subject_id: 1, agent_id: 1, business_day: 1, publication_revision: 1, source_id: 1, revision: 1, input_fingerprint: 1 } };
    if (stage === "outreach_lead_change") {
      // The Granot run records its handoff independently. Creation/admission/refusal
      // results and expansion guards are different keys. Require a subsequent evaluated
      // projection of this same Lead subject as evidence that its nomination was consumed.
      const ids = group.map(r => new ObjectId(r.doc.result.subject_id));
      const subjects = await db.collection("sales_outreach_subjects").find({ _id: { $in: ids } },
        { session, projection: { lead_id: 1, lead_model: 1 } }).toArray();
      const leadKeys = new Map(subjects.map(s => [String(s._id), "outreach-lead:" + s.lead_model + ":" + s.lead_id]));
      const projections = await db.collection("sales_outreach_projections").find({ subject_id: { $in: ids } },
        { session, projection: { subject_id: 1, computed_as_of: 1, publication_revision: 1 } }).toArray();
      const evaluated = new Map(projections.filter(p => p.publication_revision > 0).map(p => [String(p.subject_id), p.computed_as_of]));
      for (const { doc } of group) {
        const id = doc.result.subject_id;
        if (leadKeys.get(id) === doc.subject_key && evaluated.get(id) >= doc.completed_at) proofs.add(String(doc._id));
      }
      continue;
    }
    if (stage === "outreach_contact_change") {
      const ids = refs.map(id => new ObjectId(contactEventId("call", String(id))));
      const events = await db.collection("sales_outreach_contact_events").find({ _id: { $in: ids }, source_kind: "call" }, options).toArray();
      const sources = new Set(events.filter(e => e.revision > 0 && e.input_fingerprint && String(e._id) === contactEventId("call", String(e.source_id))).map(e => String(e.source_id)));
      const calls = await db.collection("call_interactions").find({ _id: { $in: refs } }, { session, projection: { projection_revision: 1 } }).toArray();
      const revisions = new Map(calls.map(c => [String(c._id), c.projection_revision]));
      for (const { doc } of group) {
        const id = String(doc.input_refs[0]);
        if (sources.has(id) && revisions.get(id) >= Number(doc.dedupe_key.split(":r").at(-1))) proofs.add(String(doc._id));
      }
    } else {
      const evaluation = stage === "outreach_evaluate";
      const coll = evaluation ? "sales_outreach_projections" : "sales_outreach_rep_day_projections";
      const filter = evaluation ? { subject_id: { $in: refs } } : { agent_id: { $in: refs }, business_day: { $in: group.map(r => r.doc.subject_key.split(":").at(-1)) } };
      const projections = await db.collection(coll).find(filter, options).toArray();
      const revisions = new Map(projections.map(p => [evaluation ? "outreach-subject:" + p.subject_id : "outreach-rep-day:" + p.agent_id + ":" + p.business_day, p.publication_revision]));
      for (const { doc } of group) if (revisions.get(doc.subject_key) >= doc.result.publication_revision) proofs.add(String(doc._id));
    }
  }
  return candidates.filter(r => proofs.has(String(r.doc._id)));
}
async function plan(db) {
  fs.mkdirSync(folder, { recursive: true });
  assert.ok(!fs.existsSync(manifestPath), "Use a fresh plan directory");
  const cutoff = selector ? new Date(selector) : new Date();
  assert.ok(Number.isFinite(+cutoff) && +cutoff <= Date.now(), "Expected a past ISO cutoff");
  const m = { recent: mode === "plan-recent", run: randomUUID(), asOf: cutoff.toISOString(), packs: [], scanned: 0, eligible: {}, held: {} };
  const asOf = Date.parse(m.asOf);
  const threshold = new Date(asOf - 3 * 86400000);
  const stage = mode === "plan-leads" ? "outreach_lead_change" : m.recent ? base.stage : { $in: base.stage.$in.filter(s => s !== "outreach_lead_change") };
  const completed_at = m.recent ? { $gt: threshold, $lte: new Date(asOf) } : { $lte: threshold };
  const cursor = db.collection("sales_intelligence_jobs").find({ ...base, stage, completed_at }, { raw: true }).sort({ _id: 1 }).hint("_id_").batchSize(1500);
  let page = [];
  async function flush() {
    const selected = await backedRows(db, page, asOf, undefined, m.recent);
    const accepted = new Set(selected.map(r => String(r.doc._id)));
    for (const { doc, raw } of page) {
      const counter = accepted.has(String(doc._id)) ? m.eligible : m.held;
      const reason = identity(doc, asOf, m.recent) ? doc.stage : doc.stage + ":unclassified";
      const item = counter[reason] ??= { rows: 0, bytes: 0 };
      item.rows++; item.bytes += raw.length;
    }
    if (selected.length) {
      const bytes = gzipSync(Buffer.concat(selected.map(r => r.raw)));
      const hash = digest(bytes);
      const file = hash + ".bson.gz";
      fs.writeFileSync(path.join(folder, file), bytes);
      m.packs.push({ file, hash, bytes: bytes.length, rows: selected.length,
        first: String(selected[0].doc._id), last: String(selected.at(-1).doc._id) });
    }
    m.scanned += page.length;
    page = [];
  }
  for await (const raw of cursor) {
    assert.ok(Buffer.isBuffer(raw));
    page.push({ raw, doc: BSON.deserialize(raw) });
    if (page.length === 2000) await flush();
  }
  if (page.length) await flush();
  save(m);
  console.log(JSON.stringify({ scanned: m.scanned, eligible: m.eligible, held: m.held, packs: m.packs.length }));
}
const objectName = (m,p) => prefix + m.run + "/" + p.file;
async function recover(m, p) {
  assert.match(p.hash, /^[a-f0-9]{64}$/);
  assert.equal(p.file, p.hash + ".bson.gz");
  assert.match(m.run, /^[a-f0-9-]{36}$/);
  assert.match(p.generation, /^\d+$/);
  const result = await store.objects.get({ bucket, object: objectName(m,p), generation: p.generation, alt: "media" }, { responseType: "arraybuffer", timeout: 30000 });
  const bytes = Buffer.from(result.data);
  assert.equal(digest(bytes), p.hash);
  const rows = decode(bytes);
  assert.equal(rows.length, p.rows);
  return rows;
}
async function verify(m) {
  for (const p of m.packs) {
    if (p.verified) continue;
    const bytes = fs.readFileSync(path.join(folder, p.file));
    assert.equal(digest(bytes), p.hash);
    if (!p.generation) {
      const name = objectName(m,p);
      try {
        const response = await store.objects.insert({ bucket, name, ifGenerationMatch: "0", fields: "generation",
          media: { mimeType: "application/gzip", body: bytes } }, { timeout: 60000 });
        p.generation = response.data.generation;
      } catch (err) {
        if (Number(err.code) !== 412) throw err;
        const { data } = await store.objects.get({ bucket, object: name });
        assert.ok(!data.customTime, "Already discharged object");
        p.generation = data.generation;
      }
      save(m);
    }
    const restored = await recover(m,p);
    assert.ok(restored.every(r => identity(r.doc, Date.parse(m.asOf), m.recent)));
    p.verified = true;
    save(m);
  }
  console.log("Verified", m.packs.length, "pinned rollback packs");
}
async function apply(client, db, m) {
  const policy = (await store.buckets.get({ bucket, fields: "lifecycle" })).data.lifecycle;
  const matching = policy?.rule?.filter(r => r.action?.type === "Delete" &&
    (!r.condition?.matchesPrefix || r.condition.matchesPrefix.some(p => prefix.startsWith(p) || p.startsWith(prefix))));
  assert.equal(matching?.length, 1, "Ambiguous rollback retention policy");
  assert.deepEqual(matching[0].condition, { daysSinceCustomTime: 30, matchesPrefix: [prefix] });
  assert.ok(m.packs.every(p => p.verified));
  const jobs = db.collection("sales_intelligence_jobs");
  for (const p of m.packs) {
    if (p.released) continue;
    const archived = await recover(m,p);
    for (let i = p.offset ?? 0; i < archived.length; i += 300) {
      const chunk = archived.slice(i,i + 300);
      const session = client.startSession();
      try {
        const outcome = await session.withTransaction(async () => {
          const byId = new Map(chunk.map(r => [String(r.doc._id), r]));
          const current = await jobs.find({ ...base, _id: { $in: chunk.map(r => r.doc._id) } }, { raw: true, session }).toArray();
          const exact = current.map(raw => ({ raw, doc: BSON.deserialize(raw) })).filter(r => byId.get(String(r.doc._id)).raw.equals(r.raw));
          const stillEligible = await backedRows(db, exact, Date.parse(m.asOf), session, m.recent);
          const ids = stillEligible.map(r => r.doc._id);
          let remainingBytes = 0;
          if (ids.length && m.recent) {
            const writes = stillEligible.map(({ doc }) => ({ updateOne: {
              filter: { ...base, _id: doc._id, payload_hash: doc.payload_hash, lease_epoch: doc.lease_epoch },
              update: { $unset: finishedExecutionFields(doc.stage), $set: { record_kind: "completion_receipt",
                routine_purge_at: routineJobExpiry(doc.stage, doc.dedupe_key, doc.result, doc.completed_at, doc.subject_key) } },
            } }));
            assert.equal((await jobs.bulkWrite(writes, { session })).modifiedCount, ids.length);
            const receipts = await jobs.find({ _id: { $in: ids }, record_kind: "completion_receipt" }, { raw: true, session }).toArray();
            assert.equal(receipts.length, ids.length);
            remainingBytes = receipts.reduce((sum, row) => sum + row.length, 0);
          } else if (ids.length) {
            assert.equal((await jobs.deleteMany({ ...base, _id: { $in: ids } }, { session })).deletedCount, ids.length);
          }
          return { removed: m.recent ? 0 : ids.length, compacted: m.recent ? ids.length : 0, remainingBytes,
            bytes: stillEligible.reduce((n,r) => n + r.raw.length,0) - remainingBytes, absentOrChanged: chunk.length - ids.length };
        }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" });
        p.removed = (p.removed ?? 0) + outcome.removed;
        p.compacted = (p.compacted ?? 0) + outcome.compacted;
        p.remainingBytes = (p.remainingBytes ?? 0) + outcome.remainingBytes;
        p.removedBytes = (p.removedBytes ?? 0) + outcome.bytes;
        p.absentOrChanged = (p.absentOrChanged ?? 0) + outcome.absentOrChanged;
        p.offset = i + chunk.length;
        save(m);
      } finally { await session.endSession(); }
    }
    // This run owns this immutable rollback generation. No archive reader or future
    // publication may reuse its path. A lost response resumes from its existing clock.
    const params = { bucket, object: objectName(m,p), generation: p.generation };
    const { data } = await store.objects.get(params);
    assert.ok(!data.temporaryHold && !data.eventBasedHold);
    if (!data.customTime) await store.objects.patch({ ...params, ifGenerationMatch: p.generation, ifMetagenerationMatch: data.metageneration,
      requestBody: { customTime: new Date().toISOString() } });
    p.released = (await store.objects.get(params)).data.customTime;
    assert.ok(p.released);
    save(m);
  }
  console.log(JSON.stringify({ removed: m.packs.reduce((n,p) => n + p.removed, 0),
    compacted: m.packs.reduce((n,p) => n + (p.compacted ?? 0), 0) }));
}
/** Read every planned id after apply. A receipt inside its window must still own its original key. */
async function reconcile(db, m) {
  const result = { asOf: new Date(), rows: 0, gone: 0, receipts: 0, expired: 0, changed: 0, earliestPending: null };
  for (const p of m.packs) {
    const file = path.join(folder, p.file);
    let archived;
    if (fs.existsSync(file)) {
      const bytes = fs.readFileSync(file);
      assert.equal(digest(bytes), p.hash);
      archived = decode(bytes);
    } else {
      archived = await recover(m, p);
    }
    const current = await db.collection("sales_intelligence_jobs").find({ _id: { $in: archived.map(r => r.doc._id) } },
      { projection: { dedupe_key: 1, status: 1, payload_hash: 1, record_kind: 1, routine_purge_at: 1 } }).toArray();
    const byId = new Map(current.map(r => [String(r._id), r]));
    for (const { doc } of archived) {
      const r = byId.get(String(doc._id));
      const expiry = routineJobExpiry(doc.stage, doc.dedupe_key, doc.result, doc.completed_at, doc.subject_key);
      result.rows++;
      if (!r && !m.recent) result.gone++;
      else if (!r && expiry && expiry <= new Date()) result.expired++;
      else if (m.recent && r?.record_kind === "completion_receipt" && r.status === "completed" && +r.routine_purge_at === +expiry &&
        r.dedupe_key === doc.dedupe_key && r.payload_hash === doc.payload_hash) {
        result.receipts++;
        if (!result.earliestPending || r.routine_purge_at < result.earliestPending) result.earliestPending = r.routine_purge_at;
      } else result.changed++;
    }
  }
  m.reconciled = result;
  save(m);
  console.log(JSON.stringify(result));
}
/** The range catalog lets recovery find an original id after loss of the operator's local directory. */
async function seal(m) {
  assert.ok(m.packs.length && m.packs.every(p => p.verified && p.released && p.offset === p.rows));
  const catalog = { run: m.run, asOf: m.asOf, packs: m.packs.map(({ file, hash, bytes, rows, generation, first, last, released }) =>
    ({ file, hash, bytes, rows, generation, first, last, released })) };
  const bytes = Buffer.from(JSON.stringify(catalog));
  const object = prefix + m.run + "/catalog.json";
  let generation;
  try {
    const response = await store.objects.insert({ bucket, name: object, ifGenerationMatch: "0", fields: "generation",
      requestBody: { customTime: new Date().toISOString() }, media: { mimeType: "application/json", body: Readable.from([bytes]) } });
    generation = response.data.generation;
  } catch (error) {
    if (Number(error.code) !== 412) throw error;
    generation = (await store.objects.get({ bucket, object })).data.generation;
  }
  const response = await store.objects.get({ bucket, object, generation, alt: "media" }, { responseType: "arraybuffer" });
  const persisted = Buffer.from(response.data);
  assert.ok(bytes.equals(persisted));
  const remoteCatalog = JSON.parse(persisted);
  const first = remoteCatalog.packs[0];
  const restored = await recover(remoteCatalog, first);
  assert.equal(String(restored[0].doc._id), first.first);
  const meta = (await store.objects.get({ bucket, object, generation })).data;
  assert.ok(meta.customTime);
  m.catalog = { object, generation, hash: digest(persisted), bytes: persisted.length, released: meta.customTime };
  save(m);
  console.log(JSON.stringify(m.catalog));
}
async function main() {
  const m = mode.startsWith("plan") ? null : JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (mode === "lookup") {
    assert.match(selector, /^[a-f0-9]{24}$/);
    for (const p of m.packs.filter(p => p.first <= selector && selector <= p.last)) {
      const row = (await recover(m,p)).find(r => String(r.doc._id) === selector);
      if (row) { console.log(JSON.stringify({ id: selector, stage: row.doc.stage, bytes: row.raw.length, sha256: digest(row.raw) })); return; }
    }
    throw new Error("Original ID missing from verified packs");
  }
  if (mode === "verify") return verify(m);
  if (mode === "seal") return seal(m);
  const client = await new MongoClient(process.env.MONGO_URI, { readPreference: "primary" }).connect();
  try {
    const db = client.db(database);
    assert.equal((await db.admin().command({ hello: 1 })).isWritablePrimary, true);
    if (mode.startsWith("plan")) await plan(db);
    else if (mode === "reconcile") await reconcile(db, m);
    else await apply(client, db, m);
  } finally { await client.close(); }
}
main().catch(e => { console.error(e.name, e.code, e.message?.replace(/mongodb(\+srv)?:\/\/\S+/g, "[connection]")); process.exitCode = 1; });
