import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const repo = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(repo, path), "utf8").replace(/\r\n/g, "\n");

function claudeProfile(name: string) {
  const match = /^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/.exec(read(`.claude/agents/${name}.md`));
  assert.ok(match, "Claude profile needs YAML frontmatter followed by a blank line");
  const fields = Object.fromEntries(match[1]!.split("\n").map((line) => {
    const [key, ...rest] = line.split(":");
    return [key!.trim(), rest.join(":").trim()];
  }));
  return { fields, body: match[2]! };
}
function codexProfile(name: string) {
  const text = read(`.codex/agents/${name}.toml`);
  const field = (key: string) => new RegExp(`^${key} = "([^"\\n]*)"$`, "m").exec(text)?.[1];
  // Literal multi-line string: the newline after the opening quotes is trimmed by TOML.
  const body = /^developer_instructions = '''\n([\s\S]*?)'''\n?$/m.exec(text)?.[1];
  return { name: field("name"), description: field("description"), body };
}

test("the Sheet Sync profile is identical for Claude Code and Codex", () => {
  const claude = claudeProfile("sheet-sync");
  const codex = codexProfile("sheet-sync");
  assert.equal(claude.fields.name, "sheet-sync");
  assert.equal(codex.name, "sheet-sync");
  assert.equal(claude.fields.description, codex.description);
  assert.ok(claude.fields.tools?.includes("Bash"));
  assert.equal(codex.body, claude.body);
  assert.ok(!claude.body.includes("'''"));
});

test("the Sheet Sync profile covers every required section and every identity failure code", () => {
  const { body } = claudeProfile("sheet-sync");
  for (const heading of ["Scope", "Owning docs", "Locked Owner rules", "Setup", "Tests: exact commands, databases and ports",
    "Read-only production access", "Reconcile: two-way placement check", "Trace one Lead from Mongo to its row",
    "Ordinary re-delivery (queueing): when and how", "Identity-check failure codes", "Forbidden actions", "Working rules learned on November 20"]) {
    assert.ok(body.split("\n").some((line) => line.startsWith(`## ${heading}`)), heading);
  }
  for (const text of ["pnpm vantage -- sheet-sync reconcile --production-read", "enqueueSheetSyncJob", 'createdBy: "script"', "never for the Calls tabs",
    "127.0.0.1:27129", "127.0.0.1:27017", "127.0.0.1:27189", "testvantagemovers_agent", "spreadsheets.readonly"]) assert.ok(body.includes(text), text);
  const sources = ["src/services/sheetSync/drainer/batchWriter.ts", "src/services/sheetSync/drainer/tabRowMap.ts"].map(read).join("\n");
  const codes = new Set(sources.match(/sheet_(?:identity|update_identity|delete)_[a-z_]+/g));
  assert.ok(codes.size >= 9);
  for (const code of codes) assert.ok(body.includes(code), code);
  // The profile's working rules are the handoff's, word for word on the rules that matter.
  for (const rule of ["Never junction `node_modules`", "Never commit with `-c core.autocrlf=false`", "Git Bash `TZ=America/New_York date` prints UTC",
    "gh pr merge --match-head-commit <sha>", "Every replica test must assert a loopback target"]) assert.ok(body.includes(rule), rule);
});
