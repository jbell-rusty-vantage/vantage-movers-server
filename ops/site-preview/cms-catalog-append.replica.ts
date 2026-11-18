/** Append-only catalog proof against the disposable loopback CMS replica. Never loads .env. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

async function main() {
  Object.assign(process.env, { MONGO_URI: "mongodb://127.0.0.1:27341/?replicaSet=cmsproof", TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: "testvantagemovers_sitepreview", SHEET_SYNC_MODE: "disabled", LEAD_MESSAGING_MODE: "disabled", CRM_FORM_LEAD_POSTING_ENABLED: "false" });
  const mongoose = (await import("mongoose")).default;
  const cms = await import("../../src/services/sitePreviewCms/store.js");
  try {
    let current;
    try { current = await cms.readContent(); }
    catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "CMS_NOT_INITIALIZED") throw error;
      await cms.installCatalog([{ key: "proof.headline", section: "Proof", label: "Headline", locale: "en", kind: "text", defaultValue: "Original" }]);
      current = await cms.readContent();
    }
    assert.equal(mongoose.connection.host, "127.0.0.1");
    assert.equal(mongoose.connection.name, "testvantagemovers_sitepreview");
    const actor = { id: "cms-catalog-append-proof", email: "proof@example.invalid", requestId: "catalog-append-proof" };
    const editable = current.catalog.find(field => field.kind === "text" && !field.defaultValue.includes("{{") && !/^(phoneDisplay|email) ·/.test(field.label));
    assert.ok(editable, "The proof needs an existing ordinary text field");
    current = await cms.saveContent({ expectedRevision: current.revision, values: { [editable.key]: "Owner content preserved across catalog append" }, testimonialPolicy: { minimumRating: 5, excludedIds: ["000000000000000000000001"] } }, actor);
    const added = { key: `proof.navigation.${Date.now()}`, section: "Navigation", label: "Navigation label", locale: "en" as const, kind: "text" as const, defaultValue: "FAQ" };
    const proposed = [...current.catalog, added];
    const checks: string[] = [];
    await assert.rejects(cms.installCatalog(proposed), { code: "CMS_CATALOG_CONFLICT" });
    assert.equal((await cms.readContent()).revision, current.revision);
    checks.push("append requires explicit operator opt-in and refusal changes nothing");
    const outcomes = await Promise.all([cms.installCatalog(proposed, { allowAppend: true }), cms.installCatalog(proposed, { allowAppend: true })]);
    assert.deepEqual(outcomes.map(result => result.appended).sort(), [0, 1]);
    const appended = await cms.readContent();
    assert.equal(appended.revision, current.revision + 1);
    assert.deepEqual(appended.values, current.values);
    assert.deepEqual(appended.testimonialPolicy, current.testimonialPolicy);
    assert.deepEqual(appended.catalog.slice(0, current.catalog.length), current.catalog);
    const history = await cms.listHistory(1, 100);
    assert.equal(history.items[0].action, "catalog-append");
    assert.deepEqual(history.items[0].changedKeys, [added.key]);
    assert.equal(history.items[0].updatedBy.id, "catalog-install");
    checks.push("concurrent identical appends commit one revision with audit and preserve Owner edits/policy");
    const replay = await cms.installCatalog(proposed);
    assert.equal(replay.appended, 0);
    assert.equal(replay.revision, appended.revision);
    await assert.rejects(cms.installCatalog(current.catalog, { allowAppend: true }), { code: "CMS_CATALOG_CONFLICT" });
    await assert.rejects(cms.installCatalog([{ ...proposed[0], defaultValue: "Unsafe changed default" }, ...proposed.slice(1)], { allowAppend: true }), { code: "CMS_CATALOG_CONFLICT" });
    assert.equal((await cms.readContent()).revision, appended.revision);
    checks.push("replay is unchanged; removal and descriptor mutation are refused atomically");
    const edited = await cms.saveContent({ expectedRevision: appended.revision, values: { [added.key]: "Questions" } }, actor);
    const restored = await cms.restoreContent({ expectedRevision: edited.revision, revision: current.revision }, actor);
    assert.deepEqual(restored.catalog, proposed);
    assert.deepEqual(restored.values, current.values);
    assert.deepEqual(restored.testimonialPolicy, current.testimonialPolicy);
    checks.push("restoring older content preserves the monotonically extended catalog");
    const dir = "docs/site-preview-cms/evidence";
    await mkdir(dir, { recursive: true });
    await writeFile(`${dir}/catalog-append-loopback-proof.json`, JSON.stringify({ passed: true, database: mongoose.connection.name, host: mongoose.connection.host, checks }, null, 2) + "\n");
    console.log(JSON.stringify({ passed: true, checks }));
  } finally { await mongoose.disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
