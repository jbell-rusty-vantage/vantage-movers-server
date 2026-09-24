/**
 * The fixture-evidence core of `generate-server-state-for-ui.ts` (reconciliation addendum §6, C26).
 *
 * Pure except for the directory reader: it discovers the frozen contract folders (`contracts/<stage>/`, a folder is a
 * stage when it holds `_capture-index.json`), reads their fixtures, and verifies that a DTO path exists in a real
 * fixture by walking the JSON. Nothing here touches a database or the network.
 *
 * Path grammar (dot-separated, relative to the fixture file's root object, so read fixtures start at `data.`):
 * - `name`        an own key of an object (the value may be null; a null value ends the walk)
 * - `name[]`      every element of the array at `name`
 * - `name[k=v]`   the elements of the array at `name` whose `k` is `v` (compared as strings)
 * - `*`           every own key of an object (maps such as `priority_counts`, `bands`)
 * - `**`          zero or more levels through objects and arrays (for envelopes not yet frozen)
 *
 * A path is **found** when the walk reaches its last token in at least one place. It **has a value** when one of the
 * reached values is neither null nor an empty array or object.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

/** The freeze order; any other stage folder sorts after these, by name. */
export const STAGE_ORDER = ["S1", "S2", "S3", "S4", "AC", "S5c", "S6", "S7", "S8", "S9"] as const;

export type Token =
  | { kind: "key"; name: string }
  | { kind: "each"; name: string }
  | { kind: "where"; name: string; key: string; value: string }
  | { kind: "any" }
  | { kind: "deep" };

export function parsePath(path: string): Token[] {
  const parts: string[] = [];
  let depth = 0, current = "";
  for (const ch of path) {
    if (ch === "[") depth++;
    if (ch === "]") depth--;
    if (ch === "." && depth === 0) { parts.push(current); current = ""; continue; }
    current += ch;
  }
  parts.push(current);
  return parts.map(part => {
    if (!part) throw new Error(`empty segment in path ${path}`);
    if (part === "*") return { kind: "any" };
    if (part === "**") return { kind: "deep" };
    const each = /^([^[\]]+)\[\]$/.exec(part);
    if (each) return { kind: "each", name: each[1]! };
    const where = /^([^[\]]+)\[([^=\]]+)=([^\]]*)\]$/.exec(part);
    if (where) return { kind: "where", name: where[1]!, key: where[2]!, value: where[3]! };
    if (/[[\]]/.test(part)) throw new Error(`bad segment ${part} in path ${path}`);
    return { kind: "key", name: part };
  });
}

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const hasOwn = (value: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(value, key);

/** Every value the path reaches (in document order). An array-valued final `name[]` yields its elements. */
export function reach(root: unknown, path: string | Token[]): unknown[] {
  const tokens = typeof path === "string" ? parsePath(path) : path;
  let frontier: unknown[] = [root];
  for (const [i, token] of tokens.entries()) {
    const last = i === tokens.length - 1;
    const next: unknown[] = [];
    for (const node of frontier) {
      switch (token.kind) {
        case "key":
          if (isObject(node) && hasOwn(node, token.name)) next.push(node[token.name]);
          break;
        case "each": {
          if (!isObject(node) || !hasOwn(node, token.name)) break;
          const value = node[token.name];
          if (Array.isArray(value)) {
            if (last && !value.length) next.push(value); // an empty array is still the field, with no value
            else next.push(...value);
          }
          break;
        }
        case "where": {
          if (!isObject(node) || !hasOwn(node, token.name)) break;
          const value = node[token.name];
          if (Array.isArray(value)) next.push(...value.filter(el => isObject(el) && hasOwn(el, token.key) && String(el[token.key]) === token.value));
          break;
        }
        case "any":
          if (isObject(node)) next.push(...Object.values(node));
          break;
        case "deep": {
          // zero or more levels: the node itself and everything below it
          const stack: unknown[] = [node];
          while (stack.length) {
            const item = stack.shift();
            next.push(item);
            if (Array.isArray(item)) stack.push(...item);
            else if (isObject(item)) stack.push(...Object.values(item));
          }
          break;
        }
      }
    }
    // A null (or scalar) can't be walked further: only the last token may land on one.
    frontier = last ? next : next.filter(value => value !== null && typeof value === "object");
    if (!frontier.length) return [];
  }
  return frontier;
}

const meaningful = (value: unknown) => value !== null && value !== undefined
  && !(Array.isArray(value) && !value.length) && !(isObject(value) && !Object.keys(value).length);

export type PathMatch = {
  found: boolean;
  /** At least one reached value is not null / empty. */
  has_value: boolean;
  /** Scalar leaves reached (strings as-is, others JSON), for observed-value lists and `expect`. */
  scalars: string[];
};

export function matchPath(root: unknown, path: string, expect?: string): PathMatch {
  const values = reach(root, path);
  const scalars = values.filter(value => value === null || typeof value !== "object").map(value => typeof value === "string" ? value : JSON.stringify(value));
  if (expect !== undefined) {
    const hit = scalars.includes(expect);
    return { found: hit, has_value: hit, scalars };
  }
  return { found: values.length > 0, has_value: values.some(meaningful), scalars };
}

export type Fixture = {
  stage: string;
  mode: "on" | "off";
  /** Relative to the contracts folder, with forward slashes: `S1/outreach__s-findings.json`, `S2/flag-off/attention__default.json`. */
  rel: string;
  file: string;
  slug: string;
  state: string;
};

export function stageSort(a: string, b: string) {
  const ia = (STAGE_ORDER as readonly string[]).indexOf(a), ib = (STAGE_ORDER as readonly string[]).indexOf(b);
  if (ia >= 0 && ib >= 0) return ia - ib;
  if (ia >= 0) return -1;
  if (ib >= 0) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Stage folders: direct children of the contracts folder that hold `_capture-index.json`. */
export function discoverStages(contractsDir: string): string[] {
  if (!existsSync(contractsDir)) return [];
  return readdirSync(contractsDir)
    .filter(name => !name.startsWith("_") && statSync(resolve(contractsDir, name)).isDirectory() && existsSync(resolve(contractsDir, name, "_capture-index.json")))
    .sort(stageSort);
}

export function slugOf(file: string) {
  const i = file.indexOf("__");
  return i < 0 ? file.replace(/\.json$/, "") : file.slice(0, i);
}
export function stateOf(file: string) {
  const i = file.indexOf("__");
  return i < 0 ? "" : file.slice(i + 2).replace(/\.json$/, "");
}

/** The fixtures of every stage (flags on and `flag-off/`), `_`-prefixed index files excluded, in stage then name order. */
export function listFixtures(contractsDir: string, stages = discoverStages(contractsDir)): Fixture[] {
  const out: Fixture[] = [];
  for (const stage of stages) {
    for (const mode of ["on", "off"] as const) {
      const dir = mode === "on" ? resolve(contractsDir, stage) : resolve(contractsDir, stage, "flag-off");
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir).filter(name => name.endsWith(".json") && !name.startsWith("_")).sort()) {
        out.push({ stage, mode, rel: mode === "on" ? `${stage}/${file}` : `${stage}/flag-off/${file}`, file, slug: slugOf(file), state: stateOf(file) });
      }
    }
  }
  return out;
}

export type FixtureReader = (rel: string) => unknown;
export function cachedReader(contractsDir: string): FixtureReader {
  const cache = new Map<string, unknown>();
  return rel => {
    if (!cache.has(rel)) cache.set(rel, JSON.parse(readFileSync(resolve(contractsDir, rel), "utf8")));
    return cache.get(rel);
  };
}

/** What the generator needs to verify one field. */
export type EvidenceQuery = {
  /** Fixture slugs (the part before `__`) that serve this field. */
  routes: readonly string[];
  /** Null: no DTO field exists for this screen fact (always `NO FIXTURE`). */
  path: string | null;
  /** A fixture (`S1/outreach__s-findings.json`) that must contain the path. */
  prefer?: string;
  /** Only fixtures whose state (the part after `__`) matches. */
  state?: RegExp;
  /** Some fixture must carry exactly this scalar at the path (an enum value that a later freeze adds). */
  expect?: string;
  /** Collect the distinct scalar values seen across every matching fixture. */
  observe?: boolean;
};

export type Evidence = {
  status: "ok" | "null_only" | "no_fixture";
  /** The fixture cited: `prefer` when it holds the path, else the first (freeze order) with a value, else the first found. */
  fixture: string | null;
  /** How many flags-on fixtures of the routes contain the path. */
  count: number;
  /** Distinct observed scalars (sorted), when `observe`. */
  observed: string[];
  problems: string[];
};

export const OBSERVED_CAP = 14;

export function findEvidence(query: EvidenceQuery, fixtures: readonly Fixture[], read: FixtureReader): Evidence {
  if (query.path === null) return { status: "no_fixture", fixture: null, count: 0, observed: [], problems: ["no DTO field exists for this screen fact"] };
  const candidates = fixtures.filter(fx => fx.mode === "on" && query.routes.includes(fx.slug) && (!query.state || query.state.test(fx.state)));
  let first: string | null = null, firstValue: string | null = null, count = 0;
  const observed = new Set<string>();
  const problems: string[] = [];
  let preferMatch: PathMatch | null = null;
  for (const fx of candidates) {
    const match = matchPath(read(fx.rel), query.path, query.expect);
    if (query.observe) for (const scalar of matchPath(read(fx.rel), query.path).scalars) observed.add(scalar);
    if (fx.rel === query.prefer) preferMatch = match;
    if (!match.found) continue;
    count++;
    first ??= fx.rel;
    if (match.has_value) firstValue ??= fx.rel;
  }
  if (query.prefer) {
    if (!candidates.some(fx => fx.rel === query.prefer)) problems.push(`preferred fixture ${query.prefer} is not a fixture of ${query.routes.join(", ")}`);
    else if (!preferMatch?.found) problems.push(`preferred fixture ${query.prefer} does not contain ${query.path}${query.expect !== undefined ? ` = ${query.expect}` : ""}`);
  }
  const sortedObserved = [...observed].sort();
  if (!count) return { status: "no_fixture", fixture: null, count: 0, observed: sortedObserved, problems };
  const cited = query.prefer && preferMatch?.found ? query.prefer : firstValue ?? first;
  const status = firstValue || (query.prefer && preferMatch?.has_value) ? "ok" : "null_only";
  return { status, fixture: cited, count, observed: sortedObserved, problems };
}

/** Markdown table cell: pipes escaped, newlines flattened. */
export function cell(text: string | null | undefined) {
  return (text ?? "").replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}

export function formatObserved(observed: readonly string[]) {
  if (!observed.length) return "";
  const shown = observed.slice(0, OBSERVED_CAP).map(value => `\`${value}\``).join(", ");
  return observed.length > OBSERVED_CAP ? `${shown}, … (${observed.length} distinct)` : shown;
}

/** A Markdown table's body rows as cells, header first. Only pipe tables at line start. */
export function markdownTables(markdown: string): string[][][] {
  const tables: string[][][] = [];
  let current: string[][] | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith("|")) { if (current) tables.push(current); current = null; continue; }
    const cells = splitRow(line);
    if (cells.every(c => /^:?-{3,}:?$/.test(c))) continue; // the separator row
    (current ??= []).push(cells);
  }
  if (current) tables.push(current);
  return tables;
}

function splitRow(line: string): string[] {
  const cells: string[] = [];
  let current = "", code = false;
  const body = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch === "\\" && body[i + 1] === "|") { current += "|"; i++; continue; }
    if (ch === "`") code = !code;
    if (ch === "|" && !code) { cells.push(current.trim()); current = ""; continue; }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

/** Decision ids named in a text: D1…, RD1…, E1…, F1…, G1…, T4-… (C-cases and stage names are not decisions). */
export function decisionIds(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(/\b(T4-[A-Z0-9]+(?:-[A-Z0-9]+)*|RD\d{1,2}|[DEFG]\d{1,2})\b/g)) ids.add(match[1]!);
  const rank = (id: string) => id.startsWith("T4-") ? 5 : id.startsWith("RD") ? 1 : ({ D: 0, E: 2, F: 3, G: 4 } as Record<string, number>)[id[0]!]!;
  return [...ids].sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    const na = Number(/\d+/.exec(a)?.[0] ?? 0), nb = Number(/\d+/.exec(b)?.[0] ?? 0);
    return na !== nb ? na - nb : a < b ? -1 : a > b ? 1 : 0;
  });
}

/** Plain fixture names cited in a text (`name__state.json`, optionally `../S1/`-prefixed); brace and `-suffix` shorthands are skipped. */
export function citedFixtureNames(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(/(?:\.\.\/)?(?:[A-Za-z0-9]+\/)?(?:flag-off\/)?[a-z][a-z0-9-]*__[a-z0-9-]+(?:__[a-z]+)?\.json/g)) names.add(match[0]);
  return [...names].sort();
}
