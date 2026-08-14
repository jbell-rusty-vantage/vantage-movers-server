import fs from "node:fs";
import path from "node:path";
import type { NormalizationFixture } from "./normalizationFixture";

export type FixtureSecurityViolation = {
  fixture_id: string;
  path: string;
  code:
    | "credential_key"
    | "credential_value"
    | "non_synthetic_email"
    | "non_reserved_phone"
    | "non_synthetic_name"
    | "street_address"
    | "raw_fixture_source"
    | "unvalidated_fixture_source"
    | "prohibited_fixture_source";
};

export const SYNTHETIC_EMAIL_DOMAIN_ALLOWLIST = ["example.invalid"] as const;
export const SYNTHETIC_NAME_ALLOWLIST = [
  "Synthetic",
  "Customer",
  "Synthetic Customer",
  "Fixture Operator",
] as const;
export const SYNTHETIC_PHONE_RANGE = "202-555-0100 through 202-555-0199";

const exactCredentialKeys = new Set([
  "authorization",
  "cookie",
  "setcookie",
  "xapisecret",
  "webhooksecret",
  "password",
  "passwd",
  "token",
  "accesstoken",
  "refreshtoken",
  "apikey",
  "clientsecret",
  "privatekey",
]);

const emailPattern = /\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi;
const jwtPattern = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/;
const credentialValuePattern = /\b(?:bearer|basic)\s+[A-Za-z0-9+/=_-]{8,}/i;
const privateKeyPattern = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i;
const urlCredentialPattern = /\bhttps?:\/\/[^\s/:]+:[^\s/@]+@/i;
const phoneShapePattern = /^\+?[\d().\s-]{10,}$/;
const streetAddressPattern =
  /\b\d{1,6}\s+(?:[A-Za-z0-9.'-]+\s+){0,4}(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|way)\b/i;

function safePathSegment(segment: string): string {
  return segment.replace(/[^A-Za-z0-9_.[\]-]/g, "_");
}

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isCredentialKey(key: string): boolean {
  const normalized = normalizedKey(key);
  return (
    exactCredentialKeys.has(normalized) ||
    /(secret|password|passwd|token|credential|signature|privatekey|apikey)/.test(
      normalized,
    )
  );
}

function isNameKey(key: string): boolean {
  return [
    "name",
    "customer",
    "customername",
    "firstname",
    "lastname",
    "displayname",
    "contactname",
    "fullname",
  ].includes(normalizedKey(key));
}

function scanString(
  value: string,
  key: string,
  fixtureId: string,
  fieldPath: string,
  violations: FixtureSecurityViolation[],
): void {
  const credentialShaped = isCredentialKey(key);
  if (
    credentialValuePattern.test(value) ||
    jwtPattern.test(value) ||
    privateKeyPattern.test(value) ||
    urlCredentialPattern.test(value) ||
    (credentialShaped && value.length >= 20 && /^[A-Za-z0-9+/=_-]+$/.test(value))
  ) {
    violations.push({ fixture_id: fixtureId, path: fieldPath, code: "credential_value" });
  }

  emailPattern.lastIndex = 0;
  for (const match of value.matchAll(emailPattern)) {
    const domain = match[1]?.toLowerCase();
    if (
      domain === undefined ||
      !SYNTHETIC_EMAIL_DOMAIN_ALLOWLIST.includes(
        domain as (typeof SYNTHETIC_EMAIL_DOMAIN_ALLOWLIST)[number],
      )
    ) {
      violations.push({
        fixture_id: fixtureId,
        path: fieldPath,
        code: "non_synthetic_email",
      });
    }
  }

  const digits = value.replace(/\D/g, "");
  const nationalDigits = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (
    nationalDigits.length === 10 &&
    phoneShapePattern.test(value) &&
    !/^20255501\d{2}$/.test(nationalDigits)
  ) {
    violations.push({ fixture_id: fixtureId, path: fieldPath, code: "non_reserved_phone" });
  }

  if (streetAddressPattern.test(value)) {
    violations.push({ fixture_id: fixtureId, path: fieldPath, code: "street_address" });
  }

  if (
    isNameKey(key) &&
    value.trim() !== "" &&
    !SYNTHETIC_NAME_ALLOWLIST.includes(
      value.trim() as (typeof SYNTHETIC_NAME_ALLOWLIST)[number],
    )
  ) {
    violations.push({ fixture_id: fixtureId, path: fieldPath, code: "non_synthetic_name" });
  }
}

function scanValue(
  value: unknown,
  fixtureId: string,
  fieldPath: string,
  key: string,
  violations: FixtureSecurityViolation[],
): void {
  if (typeof value === "string") {
    scanString(value, key, fixtureId, fieldPath, violations);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      scanValue(item, fixtureId, `${fieldPath}[${index}]`, String(index), violations),
    );
    return;
  }
  if (typeof value !== "object" || value === null) {
    return;
  }

  for (const [childKey, childValue] of Object.entries(value)) {
    const childPath = `${fieldPath}.${safePathSegment(childKey)}`;
    if (isCredentialKey(childKey)) {
      violations.push({ fixture_id: fixtureId, path: childPath, code: "credential_key" });
    }
    scanValue(childValue, fixtureId, childPath, childKey, violations);
  }
}

export function scanLifecycleFixtures(
  fixtures: readonly NormalizationFixture[],
): FixtureSecurityViolation[] {
  const violations: FixtureSecurityViolation[] = [];
  for (const fixture of fixtures) {
    scanValue(fixture, fixture.fixture_id, "$", "", violations);
  }
  return violations;
}

export function scanLifecycleFixtureSourcePaths(
  sourcePaths: readonly string[],
  workspaceRoot: string,
): FixtureSecurityViolation[] {
  const violations: FixtureSecurityViolation[] = [];
  for (const sourcePath of sourcePaths) {
    const relativePath = path.relative(workspaceRoot, sourcePath).replaceAll("\\", "/");
    const safeRelativePath = safePathSegment(relativePath.replaceAll("/", "."));
    if (/\.(?:json|jsonl|ya?ml)$/i.test(sourcePath)) {
      violations.push({
        fixture_id: "fixture_source_inventory",
        path: safeRelativePath,
        code: "raw_fixture_source",
      });
    }
    if (
      /(?:^|\/)(?:current[-_]?payloads?|customer[-_]?fixtures?|captured[-_]?payloads?)(?:\/|$)/i.test(
        relativePath,
      ) ||
      /scripts\/prototypes\/granot-lead-lifecycle\/(?:fixtures\.ts|payload_shapes\.md)$/i.test(
        relativePath,
      )
    ) {
      violations.push({
        fixture_id: "fixture_source_inventory",
        path: safeRelativePath,
        code: "prohibited_fixture_source",
      });
    }
  }
  return violations;
}

const inventorySkipDirectories = new Set([".git", "node_modules", ".pnpm"]);
const prohibitedFixtureDirectoryPattern =
  /^(?:current[-_]?payloads?|customer[-_]?fixtures?|captured[-_]?payloads?)$/i;
const allowedFixtureSupportPaths = new Set([
  "testSupport/fixtureSecurity.ts",
  "testSupport/normalizationFixture.ts",
]);
const fixtureSourceDirectoryPattern =
  /^(?:fixtures?|samples?|cases?|test[-_]?data|test[-_]?support)$/i;
const fixtureSourceFilePattern =
  /(?:^|[-_.])(?:fixtures?|payloads?|samples?|cases?|statements?|observations?)(?:[-_.]|$)/i;

function walkFiles(
  directory: string,
  onDirectory: (directoryPath: string, name: string) => boolean,
  files: string[],
): void {
  if (!fs.existsSync(directory)) {
    return;
  }
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (inventorySkipDirectories.has(entry.name) || !onDirectory(entryPath, entry.name)) {
        continue;
      }
      walkFiles(entryPath, onDirectory, files);
      continue;
    }
    if (entry.isFile()) {
      files.push(entryPath);
    }
  }
}

export function scanLifecycleFixtureInventory(
  workspaceRoot: string,
  validatedFixtureSourcePaths: readonly string[],
  lifecycleServiceRoot: string = path.join(
    workspaceRoot,
    "src",
    "services",
    "granotLifecycle",
  ),
): FixtureSecurityViolation[] {
  const violations: FixtureSecurityViolation[] = [];
  const validatedSources = new Set(
    validatedFixtureSourcePaths.map((sourcePath) => path.resolve(sourcePath)),
  );
  const lifecycleFiles: string[] = [];
  walkFiles(lifecycleServiceRoot, () => true, lifecycleFiles);

  violations.push(
    ...scanLifecycleFixtureSourcePaths(lifecycleFiles, workspaceRoot),
  );
  for (const sourcePath of lifecycleFiles) {
    const baseName = path.basename(sourcePath);
    const relativeSourcePath = path
      .relative(lifecycleServiceRoot, sourcePath)
      .replaceAll("\\", "/");
    const relativeSegments = relativeSourcePath.split("/").slice(0, -1);
    const isFixtureCandidate =
      !baseName.endsWith(".test.ts") &&
      (fixtureSourceFilePattern.test(baseName) ||
        relativeSegments.some((segment) => fixtureSourceDirectoryPattern.test(segment)));
    if (
      isFixtureCandidate &&
      !allowedFixtureSupportPaths.has(relativeSourcePath) &&
      !validatedSources.has(path.resolve(sourcePath))
    ) {
      violations.push({
        fixture_id: "fixture_source_inventory",
        path: safePathSegment(path.relative(workspaceRoot, sourcePath).replaceAll("\\", ".")),
        code: "unvalidated_fixture_source",
      });
    }
  }

  const ignoredRepositoryFiles: string[] = [];
  walkFiles(
    workspaceRoot,
    (directoryPath, name) => {
      if (prohibitedFixtureDirectoryPattern.test(name)) {
        violations.push({
          fixture_id: "fixture_source_inventory",
          path: safePathSegment(
            path.relative(workspaceRoot, directoryPath).replaceAll("\\", "."),
          ),
          code: "prohibited_fixture_source",
        });
        return false;
      }
      return true;
    },
    ignoredRepositoryFiles,
  );

  return violations;
}

export function assertLifecycleFixturesAreSynthetic(
  fixtures: readonly NormalizationFixture[],
  sourcePaths: readonly string[] = [],
  workspaceRoot: string = process.cwd(),
): void {
  const violations = [
    ...scanLifecycleFixtures(fixtures),
    ...scanLifecycleFixtureSourcePaths(sourcePaths, workspaceRoot),
    ...scanLifecycleFixtureInventory(workspaceRoot, sourcePaths),
  ];
  if (violations.length === 0) {
    return;
  }
  const safeLocations = violations
    .map(({ fixture_id, path: fieldPath, code }) => `${fixture_id}:${fieldPath}:${code}`)
    .join(", ");
  throw new Error(`Lifecycle fixture security scan rejected ${safeLocations}`);
}
