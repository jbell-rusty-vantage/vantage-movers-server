import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  cachedReader, citedFixtureNames, decisionIds, discoverStages, findEvidence, listFixtures, markdownTables, matchPath, parsePath, reach,
  type Fixture,
} from "./server-state-for-ui";

const page = {
  ok: true,
  as_of: "2026-09-24T20:34:37.728Z",
  data: {
    items: [
      { kind: "call", call: { in_progress: true, observed_reason: null, rep: null }, detail: {} },
      { kind: "call", call: { in_progress: false, observed_reason: "recovered", rep: { name: "Dana Reyes" } } },
      { kind: "band_changed", detail: { cause: { kind: "baseline" }, estimated: true } },
    ],
    empty: [],
    priority_counts: { "0": { active: 2 }, no_lead: { active: 1 } },
    outreach: null,
  },
};

test("parsePath: keys, [] , [k=v], * and ** (dots inside brackets stay in the segment)", () => {
  assert.deepEqual(parsePath("data.items[kind=a.b].call.*.x.**"), [
    { kind: "key", name: "data" }, { kind: "where", name: "items", key: "kind", value: "a.b" }, { kind: "key", name: "call" },
    { kind: "any" }, { kind: "key", name: "x" }, { kind: "deep" },
  ]);
  assert.deepEqual(parsePath("a[]"), [{ kind: "each", name: "a" }]);
  assert.throws(() => parsePath("a..b"), /empty segment/);
  assert.throws(() => parsePath("a[b"), /bad segment/);
});

test("matchPath: a present key is found even when null; a missing key is not", () => {
  assert.deepEqual(matchPath(page, "data.outreach"), { found: true, has_value: false, scalars: ["null"] });
  assert.equal(matchPath(page, "data.outreach.id").found, false, "a null can't be walked into");
  assert.equal(matchPath(page, "data.nope").found, false);
  assert.equal(matchPath(page, "as_of").has_value, true);
});

test("matchPath: [] reaches every element; an empty final array is found without a value", () => {
  assert.deepEqual(reach(page, "data.items[].kind"), ["call", "call", "band_changed"]);
  assert.deepEqual(matchPath(page, "data.empty[]"), { found: true, has_value: false, scalars: [] });
  assert.equal(matchPath(page, "data.empty[].x").found, false);
  // one element with a value is enough
  assert.equal(matchPath(page, "data.items[].call.rep.name").has_value, true);
  assert.equal(matchPath(page, "data.items[].call.rep").found, true);
});

test("matchPath: [k=v] filters array elements", () => {
  assert.deepEqual(reach(page, "data.items[kind=band_changed].detail.cause.kind"), ["baseline"]);
  assert.equal(matchPath(page, "data.items[kind=call].detail.cause").found, false);
  assert.equal(matchPath(page, "data.items[kind=receiver_agent_changed].kind").found, false);
});

test("matchPath: * over map keys, ** at any depth", () => {
  assert.deepEqual(reach(page, "data.priority_counts.*.active"), [2, 1]);
  assert.equal(matchPath(page, "**.estimated").has_value, true);
  assert.equal(matchPath(page, "**.email").found, false);
});

test("matchPath: expect needs that exact scalar somewhere on the path", () => {
  assert.equal(matchPath(page, "data.items[kind=call].call.in_progress", "true").found, true);
  assert.equal(matchPath(page, "data.items[kind=call].call.observed_reason", "late_capture").found, false);
  assert.equal(matchPath(page, "data.items[].call.observed_reason", "recovered").has_value, true);
});

function contractsFixture() {
  const dir = mkdtempSync(join(tmpdir(), "si-state-"));
  const write = (rel: string, body: unknown) => { mkdirSync(join(dir, rel, ".."), { recursive: true }); writeFileSync(join(dir, rel), JSON.stringify(body)); };
  write("S1/_capture-index.json", { stage: "S1", calls: [] });
  write("S1/outreach__a.json", { ok: true, data: { outreach: { live_call: null } } });
  write("S1/outreach__b.json", { ok: true, data: { outreach: { live_call: { rep: { text: "Dana" } } } } });
  write("S1/attention__default.json", { ok: true, data: { items: [] } });
  write("S1/flag-off/outreach__a.json", { ok: true, data: { outreach: { live_call: { rep: { text: "off" } } } } });
  write("S5c/_capture-index.json", { stage: "S5c", calls: [] });
  write("S5c/outreach__rep-scope.json", { ok: true, data: { outreach: { live_call: { rep: { text: "Rep" } } } } });
  write("S10/_capture-index.json", { stage: "S10", calls: [] });
  write("S10/_seed-manifest.json", { rows: [] });
  write("notastage/outreach__x.json", { ok: true });
  return dir;
}

test("discoverStages / listFixtures: stage folders need _capture-index.json; freeze order; `_` files skipped; flag-off kept apart", () => {
  const dir = contractsFixture();
  try {
    assert.deepEqual(discoverStages(dir), ["S1", "S5c", "S10"]);
    const fixtures = listFixtures(dir);
    assert.deepEqual(fixtures.map(f => f.rel), ["S1/attention__default.json", "S1/outreach__a.json", "S1/outreach__b.json", "S1/flag-off/outreach__a.json", "S5c/outreach__rep-scope.json"]);
    assert.deepEqual(fixtures.map(f => f.mode), ["on", "on", "on", "off", "on"]);
    assert.equal(fixtures[4]!.slug, "outreach");
    assert.equal(fixtures[4]!.state, "rep-scope");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("findEvidence: cites the first fixture with a value, counts every fixture holding the path, never uses flag-off", () => {
  const dir = contractsFixture();
  try {
    const fixtures = listFixtures(dir), read = cachedReader(dir);
    const live = findEvidence({ routes: ["outreach"], path: "data.outreach.live_call", observe: true }, fixtures, read);
    assert.equal(live.status, "ok");
    assert.equal(live.fixture, "S1/outreach__b.json", "a.json holds only null");
    assert.equal(live.count, 3);
    assert.deepEqual(live.observed, ["null"]);
    const text = findEvidence({ routes: ["outreach"], path: "data.outreach.live_call.rep.text", observe: true }, fixtures, read);
    assert.deepEqual(text.observed, ["Dana", "Rep"], "flag-off values are not observed");
    const onlyNull = findEvidence({ routes: ["outreach"], path: "data.outreach.live_call", state: /^a$/ }, fixtures, read);
    assert.equal(onlyNull.status, "null_only");
    assert.equal(onlyNull.fixture, "S1/outreach__a.json");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("findEvidence: NO FIXTURE for a missing path, another route, an unmatched state, an unmet expect, or no DTO field", () => {
  const dir = contractsFixture();
  try {
    const fixtures = listFixtures(dir), read = cachedReader(dir);
    const none = (query: Parameters<typeof findEvidence>[0]) => findEvidence(query, fixtures, read);
    assert.equal(none({ routes: ["outreach"], path: "data.outreach.receiver_agent.agent.name" }).status, "no_fixture");
    assert.equal(none({ routes: ["attention"], path: "data.outreach.live_call" }).status, "no_fixture");
    assert.equal(none({ routes: ["outreach"], path: "data.outreach.live_call.rep.text", state: /^rep-other/ }).status, "no_fixture");
    assert.equal(none({ routes: ["outreach"], path: "data.outreach.live_call.rep.text", expect: "off" }).status, "no_fixture", "only the flag-off fixture has it");
    const gap = none({ routes: ["outreach"], path: null });
    assert.equal(gap.status, "no_fixture");
    assert.match(gap.problems[0]!, /no DTO field/);
    const scoped = none({ routes: ["outreach"], path: "data.outreach.live_call.rep.text", state: /^rep(?:-|$)/, expect: "Rep" });
    assert.equal(scoped.status, "ok");
    assert.equal(scoped.fixture, "S5c/outreach__rep-scope.json");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("findEvidence: a preferred fixture is cited when it holds the path, and is a problem when it doesn't", () => {
  const dir = contractsFixture();
  try {
    const fixtures = listFixtures(dir), read = cachedReader(dir);
    const preferred = findEvidence({ routes: ["outreach"], path: "data.outreach.live_call", prefer: "S1/outreach__a.json" }, fixtures, read);
    assert.equal(preferred.fixture, "S1/outreach__a.json");
    assert.equal(preferred.status, "ok", "another fixture has a value");
    assert.deepEqual(preferred.problems, []);
    const wrong = findEvidence({ routes: ["outreach"], path: "data.outreach.live_call.rep.text", prefer: "S1/outreach__a.json" }, fixtures, read);
    assert.equal(wrong.fixture, "S1/outreach__b.json");
    assert.match(wrong.problems[0]!, /does not contain/);
    const notOfRoute = findEvidence({ routes: ["outreach"], path: "data.outreach.live_call", prefer: "S1/attention__default.json" }, fixtures, read);
    assert.match(notOfRoute.problems[0]!, /is not a fixture of outreach/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("findEvidence is deterministic: the same inputs cite the same fixture in freeze order", () => {
  const fixtures: Fixture[] = ["S9", "S1", "AC"].map(stage => ({ stage, mode: "on", rel: `${stage}/x__s.json`, file: "x__s.json", slug: "x", state: "s" }));
  const sorted = [...fixtures].sort((a, b) => ["S1", "AC", "S9"].indexOf(a.stage) - ["S1", "AC", "S9"].indexOf(b.stage));
  const read = () => ({ data: { v: 1 } });
  assert.equal(findEvidence({ routes: ["x"], path: "data.v" }, sorted, read).fixture, "S1/x__s.json");
});

test("CONTRACT.md helpers: tables (escaped pipes, pipes in code), decision ids, cited fixture names", () => {
  const md = [
    "Intro", "",
    "| Field | Meaning | Fixture |", "|---|---|---|",
    "| `a \\| b` | uses `x|y` code (G3, E12, F8, RD7, T4-VAC-A1, D14) | `outreach__t3-live-call.json`, `../S1/outreach__s-findings.json` |",
    "", "| Other | x |", "| --- | --- |", "| r | s |",
  ].join("\n");
  const tables = markdownTables(md);
  assert.equal(tables.length, 2);
  assert.deepEqual(tables[0]![0], ["Field", "Meaning", "Fixture"]);
  assert.equal(tables[0]![1]![0], "`a | b`");
  assert.equal(tables[0]![1]![1], "uses `x|y` code (G3, E12, F8, RD7, T4-VAC-A1, D14)");
  assert.deepEqual(decisionIds(tables[0]![1]!.join(" ")), ["D14", "RD7", "E12", "F8", "G3", "T4-VAC-A1"]);
  assert.deepEqual(decisionIds("C26 S5c CF6 E2E"), [], "C-cases, stages and freezes are not decisions");
  assert.deepEqual(citedFixtureNames(tables[0]![1]!.join(" ")), ["../S1/outreach__s-findings.json", "outreach__t3-live-call.json"]);
  assert.deepEqual(citedFixtureNames("`closed-history__outcome-booked-granot-booked-page-{1,2}.json`"), [], "brace shorthand is skipped");
});

test("listFixtures: a stage's other subfolders (not flag-off/, reports/) are flags-on fixtures with a folder-prefixed slug (CF-FINAL)", () => {
  const dir = mkdtempSync(join(tmpdir(), "si-state-"));
  const write = (rel: string, body: unknown) => { mkdirSync(join(dir, rel, ".."), { recursive: true }); writeFileSync(join(dir, rel), JSON.stringify(body)); };
  try {
    write("S8/_capture-index.json", { stage: "S8", calls: [] });
    write("S8/rep-attention__default.json", { ok: true, data: { items: [] } });
    write("S8/admin-users/list__after.json", { status: 200, body: { ok: true, data: { users: [{ email: "a@example.invalid" }] } } });
    write("S8/admin-users/audit-log.json", []);
    write("S8/reports/ignored.json", {});
    write("S8/flag-off/rep-refused__attention.json", { status: 403 });
    const fixtures = listFixtures(dir);
    assert.deepEqual(fixtures.map(f => `${f.mode} ${f.rel} ${f.slug}`), ["on S8/rep-attention__default.json rep-attention", "on S8/admin-users/audit-log.json admin-users/audit-log",
      "on S8/admin-users/list__after.json admin-users/list", "off S8/flag-off/rep-refused__attention.json rep-refused"]);
    const evidence = findEvidence({ routes: ["admin-users/list"], path: "body.data.users[].email" }, fixtures, cachedReader(dir));
    assert.equal(evidence.status, "ok");
    assert.equal(evidence.fixture, "S8/admin-users/list__after.json");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
