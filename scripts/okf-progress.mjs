#!/usr/bin/env node
/**
 * Disk-backed OKF conversion progress. Writes .cursor/okf-workspace/PROGRESS.md
 * when passed --write. Agents must not hand-edit that file.
 *
 *   pnpm okf:progress
 *   pnpm okf:progress --write
 *   pnpm okf:progress --json
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UNITS_PATH = join(ROOT, ".cursor/okf-workspace/units.json");
const PROGRESS_PATH = join(ROOT, ".cursor/okf-workspace/PROGRESS.md");

function parseArgs(argv) {
  return { write: argv.includes("--write"), json: argv.includes("--json") };
}

function repoPath(rel) {
  return join(ROOT, rel);
}

function exists(rel) {
  return existsSync(repoPath(rel));
}

function readText(rel) {
  try {
    return readFileSync(repoPath(rel), "utf8");
  } catch {
    return null;
  }
}

function parseFrontmatter(text) {
  if (!text || (!text.startsWith("---\n") && !text.startsWith("---\r\n"))) {
    return null;
  }
  const end = text.indexOf("\n---", 4);
  if (end === -1) return null;
  const block = text.slice(4, end).replace(/\r/g, "");
  const data = {};
  for (const line of block.split("\n")) {
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!m) continue;
    data[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return data.type ? data : null;
}

function packageScripts() {
  const raw = readText("package.json");
  if (!raw) return {};
  try {
    return JSON.parse(raw).scripts || {};
  } catch {
    return {};
  }
}

function runCheck(check) {
  if (!check) return { ok: false, detail: "no-check" };
  if (check.kind === "exists") {
    return { ok: exists(check.path), detail: check.path };
  }
  if (check.kind === "package_script") {
    return { ok: Boolean(packageScripts()[check.name]), detail: check.name };
  }
  if (check.kind === "contains") {
    const text = readText(check.path);
    if (text == null) return { ok: false, detail: `missing:${check.path}` };
    return { ok: text.includes(check.needle), detail: check.path };
  }
  if (check.kind === "yaml_type") {
    const fm = parseFrontmatter(readText(check.path));
    return {
      ok: Boolean(fm && fm.type === check.type),
      detail: fm ? `${check.path}:${fm.type}` : `no-yaml:${check.path}`,
    };
  }
  return { ok: false, detail: `unknown-check:${check.kind}` };
}

function isStub(rel) {
  const text = readText(rel);
  if (text == null) return false;
  const fm = parseFrontmatter(text);
  if (fm && fm.status === "deprecated") return true;
  return /^moved\b/i.test(text.replace(/^---[\s\S]*?---\s*/, "").trim());
}

function isStamped(rel) {
  return Boolean(parseFrontmatter(readText(rel)));
}

function serviceStatus(svc) {
  const stamped = isStamped(svc.current) || isStamped(svc.target);
  const targetStamped = isStamped(svc.target);
  const currentGone = !exists(svc.current);
  const moved = targetStamped && (currentGone || isStub(svc.current));
  return { stamped, moved };
}

function adrStatus(adr) {
  if (!exists(adr.path)) {
    return adr.optional_checkout
      ? { state: "skipped-absent", stamped: false }
      : { state: "missing", stamped: false };
  }
  const stamped = isStamped(adr.path);
  return { state: stamped ? "stamped" : "unstamped", stamped };
}

function detectPass(board) {
  const contractOpen = board.contract.some((u) => !u.ok);
  if (contractOpen) return 0;
  const stampOpen = board.services.some((s) => !s.stamped);
  const adrOpen = board.adrs.some((a) => a.state === "unstamped" || a.state === "missing");
  if (stampOpen || adrOpen) return 1;
  const pass2MoveOpen = board.services.some((s) => s.move_pass === 2 && !s.moved);
  const pass2RouterOpen = board.routers.some((r) => r.pass === 2 && !r.ok);
  if (pass2MoveOpen || pass2RouterOpen) return 2;
  if (board.services.some((s) => !s.moved)) return 3;
  if (board.routers.some((r) => r.pass === 4 && !r.ok)) return 4;
  return "done";
}

const CLUSTER_ORDER = [
  "pass-2",
  "leads",
  "bookings",
  "sheets",
  "search",
  "catalog",
  "granot-lifecycle",
];

function nextUnit(pass, board) {
  if (pass === 0) {
    const u = board.contract.find((c) => !c.ok);
    return u ? { id: u.id, title: u.title } : null;
  }
  if (pass === 1) {
    const svc = board.services.find((s) => !s.stamped);
    if (svc) return { id: svc.id, title: `stamp ${svc.current}` };
    const adr = board.adrs.find((a) => a.state === "unstamped" || a.state === "missing");
    if (adr) return { id: adr.id, title: `stamp ${adr.path}` };
    return null;
  }
  if (pass === 2) {
    const svc = board.services.find((s) => s.move_pass === 2 && !s.moved);
    if (svc) return { id: svc.id, title: `move ${svc.current} → ${svc.target}` };
    const r = board.routers.find((x) => x.pass === 2 && !x.ok);
    return r ? { id: r.id, title: r.title } : null;
  }
  if (pass === 3) {
    for (const cluster of CLUSTER_ORDER) {
      if (cluster === "pass-2") continue;
      const svc = board.services.find((s) => s.cluster === cluster && !s.moved);
      if (svc) return { id: svc.id, title: `move cluster ${cluster}: ${svc.current}` };
    }
    return null;
  }
  if (pass === 4) {
    const r = board.routers.find((x) => x.pass === 4 && !x.ok);
    return r ? { id: r.id, title: r.title } : null;
  }
  return { id: "done", title: "Conversion complete. Do not start maintenance." };
}

function mark(ok) {
  return ok ? "done" : "open";
}

function renderProgress(report) {
  const lines = [
    "# OKF conversion progress",
    "",
    "Generated by `pnpm okf:progress --write`. Do not hand-edit.",
    "",
    `- Pass: **${report.pass}**`,
    `- Next: \`${report.next.id}\` — ${report.next.title}`,
    `- Contract: ${report.counts.contract_done}/${report.counts.contract_total}`,
    `- Services stamped: ${report.counts.stamped}/${report.counts.services}`,
    `- Services moved: ${report.counts.moved}/${report.counts.services}`,
    `- ADRs: ${report.counts.adrs_stamped} stamped, ${report.counts.adrs_skipped} skipped-absent, ${report.counts.adrs_open} open`,
    `- Routers: ${report.counts.routers_done}/${report.counts.routers_total}`,
    "",
    "## Contract (Pass 0)",
    "",
  ];
  for (const u of report.contract) {
    lines.push(`- [${u.ok ? "x" : " "}] \`${u.id}\` ${u.title}`);
  }
  lines.push("", "## ADRs (Pass 1 stamp)", "");
  for (const a of report.adrs) {
    lines.push(`- [${a.stamped ? "x" : " "}] \`${a.id}\` ${a.state} — ${a.path}`);
  }
  lines.push("", "## Services", "");
  let cluster = "";
  for (const s of report.services) {
    if (s.cluster !== cluster) {
      cluster = s.cluster;
      lines.push("", `### ${cluster}`, "");
    }
    lines.push(
      `- stamp:${mark(s.stamped)} move:${mark(s.moved)} \`${s.id}\` → \`${s.target}\``,
    );
  }
  lines.push("", "## Routers", "");
  for (const r of report.routers) {
    lines.push(`- [${r.ok ? "x" : " "}] pass ${r.pass} \`${r.id}\` ${r.title}`);
  }
  lines.push("");
  return lines.join("\n");
}

function loadUnits() {
  const units = JSON.parse(readFileSync(UNITS_PATH, "utf8"));
  if (units.services.length !== 36) {
    throw new Error(`units.json must list 36 services, got ${units.services.length}`);
  }
  if (units.adrs.length !== 3) {
    throw new Error(`units.json must list 3 ADRs, got ${units.adrs.length}`);
  }
  return units;
}

function buildReport(units) {
  const contract = units.contract.map((u) => ({ ...u, ...runCheck(u.check) }));
  const adrs = units.adrs.map((a) => ({ ...a, ...adrStatus(a) }));
  const services = units.services.map((s) => ({ ...s, ...serviceStatus(s) }));
  const routers = units.routers.map((r) => ({ ...r, ...runCheck(r.check) }));
  const board = { contract, adrs, services, routers };
  const pass = detectPass(board);
  const next = nextUnit(pass, board);
  return {
    pass,
    next,
    contract,
    adrs,
    services,
    routers,
    counts: {
      contract_done: contract.filter((u) => u.ok).length,
      contract_total: contract.length,
      services: services.length,
      stamped: services.filter((s) => s.stamped).length,
      moved: services.filter((s) => s.moved).length,
      adrs_stamped: adrs.filter((a) => a.stamped).length,
      adrs_skipped: adrs.filter((a) => a.state === "skipped-absent").length,
      adrs_open: adrs.filter((a) => a.state === "unstamped" || a.state === "missing").length,
      routers_done: routers.filter((r) => r.ok).length,
      routers_total: routers.length,
    },
  };
}

const flags = parseArgs(process.argv.slice(2));
const report = buildReport(loadUnits());

if (flags.write) {
  writeFileSync(PROGRESS_PATH, renderProgress(report), "utf8");
}

if (flags.json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(`pass\t${report.pass}\n`);
  process.stdout.write(`next\t${report.next.id}\t${report.next.title}\n`);
  process.stdout.write(
    `contract\t${report.counts.contract_done}/${report.counts.contract_total}\n`,
  );
  process.stdout.write(`stamped\t${report.counts.stamped}/${report.counts.services}\n`);
  process.stdout.write(`moved\t${report.counts.moved}/${report.counts.services}\n`);
  process.stdout.write(
    `adrs\tstamped=${report.counts.adrs_stamped}\tskipped=${report.counts.adrs_skipped}\topen=${report.counts.adrs_open}\n`,
  );
  process.stdout.write(
    `routers\t${report.counts.routers_done}/${report.counts.routers_total}\n`,
  );
  if (flags.write) process.stdout.write(`wrote\t.cursor/okf-workspace/PROGRESS.md\n`);
}
