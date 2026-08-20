import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  sanitizePayloads,
  type JsonValue,
  type SanitizerCustody,
} from "./sanitizer";

const workspaceRoot = path.resolve(__dirname, "..", "..");
const acceptedExtensions = new Set([
  ".form",
  ".json",
  ".jsonl",
  ".md",
  ".ndjson",
  ".txt",
  ".urlencoded",
]);

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`UNIT-34 environment gate requires ${name}`);
  return value;
}

function requireLiteral(name: string, expected: string): void {
  if (requiredEnvironment(name) !== expected) {
    throw new Error(`UNIT-34 environment gate rejected ${name}`);
  }
}

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertApprovedPosture(inputDirectory: string, outputDirectory: string): SanitizerCustody {
  requireLiteral("GRANOT_UNIT34_CUSTODY_APPROVED", "true");
  requireLiteral("GRANOT_UNIT34_ALLOWED_OPERATOR", "primary_agent");
  const custodian = requiredEnvironment("GRANOT_UNIT34_CUSTODIAN_CATEGORY");
  if (custodian !== "owner" && custodian !== "approved_operator") {
    throw new Error("UNIT-34 environment gate rejected custodian category");
  }
  const retention = requiredEnvironment("GRANOT_UNIT34_RETENTION");
  if (retention !== "retain" && retention !== "delete_after_certification") {
    throw new Error("UNIT-34 environment gate rejected retention instruction");
  }
  const expiresAt = new Date(requiredEnvironment("GRANOT_UNIT34_ACCESS_EXPIRES_AT"));
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    throw new Error("UNIT-34 access window is invalid or expired");
  }
  if (isInside(workspaceRoot, inputDirectory)) {
    throw new Error("UNIT-34 raw input must be outside the repository");
  }
  if (isInside(workspaceRoot, outputDirectory)) {
    throw new Error("UNIT-34 derivative output must be outside the repository");
  }
  if (inputDirectory === outputDirectory || isInside(inputDirectory, outputDirectory)) {
    throw new Error("UNIT-34 output must not overlap raw input");
  }
  if (!fs.statSync(inputDirectory).isDirectory()) {
    throw new Error("UNIT-34 approved input is not a directory");
  }
  return {
    source_category: "owner_approved_external_files",
    custodian_category: custodian,
    allowed_operator: "primary_agent",
    retention,
  };
}

function parseUrlEncoded(content: string): JsonValue {
  const result: Record<string, JsonValue> = {};
  for (const [key, value] of new URLSearchParams(content)) {
    const current = result[key];
    if (current === undefined) result[key] = value;
    else if (Array.isArray(current)) current.push(value);
    else result[key] = [current, value];
  }
  return result;
}

function assertJsonValue(value: unknown): asserts value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(assertJsonValue);
    return;
  }
  if (typeof value === "object") {
    Object.values(value).forEach(assertJsonValue);
    return;
  }
  throw new Error("UNIT-34 input contains a non-JSON value");
}

function parseJsonCandidates(content: string): JsonValue[] {
  const values: JsonValue[] = [];
  const fenced = [...content.matchAll(/```(?:json)?\s*([\s\S]*?)```/giu)];
  for (const match of fenced) {
    const candidate = match[1]?.trim();
    if (!candidate) continue;
    try {
      const value: unknown = JSON.parse(candidate);
      assertJsonValue(value);
      values.push(value);
    } catch {
      // A non-JSON documentation fence is not a payload candidate.
    }
  }
  if (values.length > 0) return values.filter(isPayloadCandidate);

  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (character !== "}" || depth === 0) continue;
    depth -= 1;
    if (depth !== 0 || start < 0) continue;
    try {
      const value: unknown = JSON.parse(content.slice(start, index + 1));
      assertJsonValue(value);
      values.push(value);
    } catch {
      // Continue scanning without disclosing rejected content.
    }
    start = -1;
  }
  return values.filter(isPayloadCandidate);
}

function isPayloadCandidate(value: JsonValue): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  if ("payload" in value) return true;
  return ["event_type", "job_no", "source", "priority", "ref_no"].some((key) => key in value);
}

function parseFile(filePath: string): JsonValue[] {
  const extension = path.extname(filePath).toLowerCase();
  const content = fs.readFileSync(filePath, "utf8");
  if (extension === ".jsonl" || extension === ".ndjson") {
    return content
      .split(/\r?\n/u)
      .filter((line) => line.trim() !== "")
      .map((line) => {
        const value: unknown = JSON.parse(line);
        assertJsonValue(value);
        return value;
      });
  }
  if (extension === ".form" || extension === ".urlencoded") return [parseUrlEncoded(content)];
  if (extension === ".md") {
    const values = parseJsonCandidates(content);
    if (values.length === 0) throw new Error("UNIT-34 Markdown source has no JSON payloads");
    return values;
  }
  try {
    const value: unknown = JSON.parse(content);
    assertJsonValue(value);
    return [value];
  } catch (error) {
    if (extension === ".txt" && content.includes("=")) return [parseUrlEncoded(content)];
    throw error;
  }
}

function collectFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(entryPath));
    else if (entry.isFile() && acceptedExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(entryPath);
    }
  }
  return files.sort();
}

function atomicWrite(filePath: string, value: unknown): void {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(temporaryPath, filePath);
}

function main(): void {
  const inputDirectory = path.resolve(requiredEnvironment("GRANOT_UNIT34_INPUT_DIR"));
  const outputDirectory = path.resolve(
    process.env.GRANOT_UNIT34_OUTPUT_DIR?.trim() ||
      path.join(os.tmpdir(), "vantage-granot-unit34-sanitized"),
  );
  const custody = assertApprovedPosture(inputDirectory, outputDirectory);
  const files = collectFiles(inputDirectory);
  if (files.length === 0) throw new Error("UNIT-34 approved input contains no supported files");

  const rawPayloads = files.flatMap(parseFile);
  if (rawPayloads.length === 0) throw new Error("UNIT-34 approved input contains no payloads");
  const result = sanitizePayloads(rawPayloads, custody);

  const runDirectory = path.join(
    outputDirectory,
    `run-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  );
  fs.mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  fs.mkdirSync(runDirectory, { recursive: false, mode: 0o700 });
  atomicWrite(path.join(runDirectory, "sanitized-payload-families.json"), result.families);
  atomicWrite(path.join(runDirectory, "schema-summary.json"), result.summary);
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      payload_count: result.summary.payload_count,
      family_count: result.summary.family_count,
      scanner: result.summary.scanner,
    })}\n`,
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : "";
  const code = message.includes("scanner rejected")
    ? "UNIT34_SCANNER_REJECTED"
    : message.includes("no JSON payloads") || message.includes("no payloads")
      ? "UNIT34_NO_PAYLOADS"
      : message.includes("environment gate") || message.includes("access window")
        ? "UNIT34_ENVIRONMENT_GATE_REJECTED"
        : "UNIT34_SANITIZER_REFUSED";
  const scanner_codes =
    code === "UNIT34_SCANNER_REJECTED"
      ? [...new Set([...message.matchAll(/:([a-z_]+)(?:,|$)/g)].map((match) => match[1]))]
      : undefined;
  process.stderr.write(`${JSON.stringify({ ok: false, code, ...(scanner_codes ? { scanner_codes } : {}) })}\n`);
  process.exitCode = 1;
}
