/** Disposable loopback-only CMS integration proof. Never loads .env. */
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { MongoClient } from "mongodb";

async function main() {
  const uri = "mongodb://127.0.0.1:27341/?replicaSet=cmsproof";
  const admin = new MongoClient("mongodb://127.0.0.1:27341/?directConnection=true");
  await admin.connect();
  try { await admin.db("admin").command({ replSetInitiate: { _id: "cmsproof", members: [{ _id: 0, host: "127.0.0.1:27341" }] } }); }
  catch (error) { if ((error as { code?: number }).code !== 23) throw error; }
  await admin.close();
  Object.assign(process.env, { MONGO_URI: uri, TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: "testvantagemovers_sitepreview", SHEET_SYNC_MODE: "disabled", LEAD_MESSAGING_MODE: "disabled", CRM_FORM_LEAD_POSTING_ENABLED: "false" });
  const mongoose = (await import("mongoose")).default;
  const cms = await import("../../src/services/sitePreviewCms/store.js");
  const { Testimonial } = await import("../../src/models/Testimonial.js");
  const actor = { id: "cms-loopback-proof", email: "cms-proof@example.com", requestId: "cms-loopback-proof" };
  const catalog = [
    { key: "home.headline", section: "Home", label: "Headline", locale: "en", kind: "text", defaultValue: "Original headline" },
    { key: "home.image", section: "Home", label: "Hero", locale: "shared", kind: "image", defaultValue: "/images/original.webp" },
    { key: "about.image", section: "About", label: "Photo", locale: "shared", kind: "image", defaultValue: "/images/about.webp" },
  ];
  const checks: string[] = [];
  try {
    await cms.installCatalog(catalog);
    assert.equal(mongoose.connection.host, "127.0.0.1");
    assert.equal(mongoose.connection.name, "testvantagemovers_sitepreview");
    assert.equal((await cms.installCatalog(catalog)).installed, false);
    let state = await cms.readContent();
    const initialRevision = state.revision;
    checks.push("catalog install and identical replay in loopback database");
    state = await cms.saveContent({ expectedRevision: state.revision, values: { "home.headline": "Edited by CMS proof" } }, actor);
    assert.equal((await cms.readPublicContent()).values["home.headline"], "Edited by CMS proof");
    await assert.rejects(cms.saveContent({ expectedRevision: initialRevision, values: { "home.headline": "Stale overwrite" } }, actor), { code: "CMS_REVISION_CONFLICT" });
    checks.push("durable edit and stale revision refusal");
    const race = await Promise.allSettled(["A", "B"].map(value => cms.saveContent({ expectedRevision: state.revision, values: { "home.headline": value } }, actor)));
    assert.equal(race.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(race.filter(result => result.status === "rejected" && result.reason.code === "CMS_REVISION_CONFLICT").length, 1);
    checks.push("concurrent writers cannot overwrite each other");
    state = await cms.readContent();
    await assert.rejects(cms.saveContent({ expectedRevision: state.revision, values: { "unknown.field": "No" } }, actor), { code: "CMS_UNKNOWN_FIELD" });
    const image = await readFile("../main-site-optimization/apps/main-site/public/images/selected-20261112/home-arrival.webp");
    const uploaded = await cms.uploadMedia({ filename: "cms-proof.webp", contentType: "image/webp", base64: image.toString("base64") }, actor);
    const media = await cms.readMedia(uploaded.id);
    const chunks: Buffer[] = [];
    for await (const chunk of media.stream) chunks.push(Buffer.from(chunk));
    assert.deepEqual(Buffer.concat(chunks), image);
    state = await cms.saveContent({ expectedRevision: state.revision, values: { "home.image": uploaded.url, "about.image": "/images/original.webp" } }, actor);
    assert.equal(state.values["home.image"], uploaded.url);
    checks.push("GridFS upload/read byte parity and catalog image reuse");
    const run = String(Date.now());
    const reviews = await Testimonial.create([
      { source: "BBB", reviewer_name: "CMS proof five stars", normalized_reviewer_name: "cms proof five stars", rating: 5, published: true, review_text: "Synthetic CMS test", review_date: new Date(), content_fingerprint: `cms-five-${run}` },
      { source: "BBB", reviewer_name: "CMS proof three stars", normalized_reviewer_name: "cms proof three stars", rating: 3, published: true, review_text: "Synthetic CMS test", review_date: new Date(), content_fingerprint: `cms-three-${run}` },
      { source: "BBB", reviewer_name: "CMS proof unpublished", normalized_reviewer_name: "cms proof unpublished", rating: 5, published: false, review_text: "Synthetic CMS test", review_date: new Date(), content_fingerprint: `cms-hidden-${run}` },
    ]);
    state = await cms.saveContent({ expectedRevision: state.revision, values: {}, testimonialPolicy: { minimumRating: 4, excludedIds: [] } }, actor);
    let listed = await cms.listCmsTestimonials(1, 100);
    assert(listed.items.some(item => item.id === String(reviews[0]._id)));
    assert(!listed.items.some(item => item.id === String(reviews[1]._id) || item.id === String(reviews[2]._id)));
    state = await cms.saveContent({ expectedRevision: state.revision, values: {}, testimonialPolicy: { minimumRating: 4, excludedIds: [String(reviews[0]._id)] } }, actor);
    listed = await cms.listCmsTestimonials(1, 100);
    assert(!listed.items.some(item => item.id === String(reviews[0]._id)));
    checks.push("published-only minimum rating and explicit exclusion in database query");
    const restored = await cms.restoreContent({ expectedRevision: state.revision, revision: initialRevision }, actor);
    assert.deepEqual(restored.values, {});
    assert.deepEqual(restored.testimonialPolicy, { minimumRating: 4, excludedIds: [] });
    const history = await cms.listHistory(1, 100);
    assert.equal(history.items[0].action, "restore");
    assert.equal(history.items[0].revision, restored.revision);
    checks.push("restore creates audited new revision preserving history");
    const dir = "docs/site-preview-cms/evidence";
    await mkdir(dir, { recursive: true });
    await writeFile(`${dir}/loopback-proof.json`, JSON.stringify({ passed: true, database: mongoose.connection.name, host: mongoose.connection.host, checks }, null, 2) + "\n");
    console.log(JSON.stringify({ passed: true, checks }));
  } finally { await mongoose.disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
