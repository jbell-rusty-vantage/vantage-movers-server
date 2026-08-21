#!/usr/bin/env node
/**
 * Print OKF frontmatter rows. Copy to vantage-main-server/scripts/okf-query.mjs
 * and run: pnpm okf:query [--type Service] [--tag ringcentral] [--status draft] [--stale] [--json]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const ROOT = process.cwd();
const SEARCH_ROOTS = ["docs"];
const SKIP_DIRS = new Set([
  "owner-daily-operations",
  "owner-daily-operations-and-intakes-reduced",
  "showcase",
  "historical_production_db_staged_merge_ingestion_plans", // pragma: allowlist secret
  "mongodb-backup-automation",
  "node_modules",
]);

function parseArgs(argv) {
  const out = { type: null, tag: null, status: null, stale: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--type") out.type = argv[++i];
    else if (a === "--tag") out.tag = argv[++i];
    else if (a === "--status") out.status = argv[++i];
    else if (a === "--stale") out.stale = true;
    else if (a === "--json") out.json = true;
  }
  return out;
}

function walk(dir, files = []) {
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name) && !name.startsWith(".")) walk(full, files);
    } else if (st.isFile() && extname(name) === ".md") {
      files.push(full);
    }
  }
  return files;
}

function parseFrontmatter(text) {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) return null;
  const end = text.indexOf("\n---", 4);
  if (end === -1) return null;
  const block = text.slice(4, end).replace(/\r/g, "");
  const data = {};
  let key = null;
  for (const line of block.split("\n")) {
    const arrayItem = line.match(/^\s+-\s+(.+)$/);
    if (arrayItem && key) {
      if (!Array.isArray(data[key])) data[key] = [];
      const v = arrayItem[1].replace(/^["']|["']$/g, "");
      if (!v.includes(": ")) data[key].push(v);
      continue;
    }
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!m) continue;
    key = m[1];
    const raw = m[2].trim();
    if (raw === "") {
      data[key] = [];
    } else if (raw.startsWith("[") && raw.endsWith("]")) {
      data[key] = raw
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else {
      data[key] = raw.replace(/^["']|["']$/g, "");
    }
  }
  return data.type ? data : null;
}

function isStale(staleAfter, today) {
  if (!staleAfter || typeof staleAfter !== "string") return false;
  return staleAfter < today;
}

const flags = parseArgs(process.argv.slice(2));
const today = new Date().toISOString().slice(0, 10);
const rows = [];

for (const relRoot of SEARCH_ROOTS) {
  for (const file of walk(join(ROOT, relRoot))) {
    const data = parseFrontmatter(readFileSync(file, "utf8"));
    if (!data) continue;
    const tags = Array.isArray(data.tags) ? data.tags : [];
    const row = {
      path: relative(ROOT, file).replaceAll("\\", "/"),
      type: data.type,
      title: data.title || "",
      tags,
      status: data.status || "",
      stale_after: data.stale_after || "",
    };
    if (flags.type && row.type !== flags.type) continue;
    if (flags.tag && !tags.includes(flags.tag)) continue;
    if (flags.status && row.status !== flags.status) continue;
    if (flags.stale && !isStale(row.stale_after, today)) continue;
    rows.push(row);
  }
}

rows.sort((a, b) => a.path.localeCompare(b.path));

if (flags.json) {
  process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
} else {
  process.stdout.write(`count\t${rows.length}\n`);
  for (const r of rows) {
    process.stdout.write(
      `${r.path}\t${r.type}\t${r.status}\t${r.stale_after}\t${r.tags.join(",")}\n`,
    );
  }
}
