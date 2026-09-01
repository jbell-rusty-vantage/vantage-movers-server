# ORS-1 — Typed label mappings and collection-first source resolution

> **Contract maturity: implementation-ready.** This is the foundation pass. It
> moves sheet and legacy label attribution out of `src/config/domain/sources.ts`
> and into a first-class, audited, Feed-addressed collection. It adds no Owner
> UI and changes no Granot behavior. ORS-3's projection reads what this pass
> creates.

## 1. Authority and required reading

- **Specification:** [`operations-registry-source-connections-owner-ui-specification.md`](../../operations-registry-source-connections-owner-ui-specification.md)
  — §2 (ownership table), §3.1, §3.3, §5.1, §6.2, §8 (label-mapping findings),
  §9.1–9.5, §9.7. The specification wins on every conflict.
- **Pack rules:** [`../README.md`](../README.md) standing constraints,
  [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md).
- **Service concept:** `docs/knowledge/services/operations-registry.md`.
- **Repository conventions:** `.cursor/rules/project-organization.mdc` — routes
  stay thin, logic lives in `src/services/<domain>/`.
- **Patterns to reuse, not reinvent:**
  - `src/services/operationsRegistry/sourceResolution.ts` — existing
    `previewSourceAttribution`, `exactMatches`, `ambiguous`, `resolved`.
  - `src/services/operationsRegistry/registryAudit.ts` — audited mutation shape.
  - `src/services/operationsRegistry/trustedActor.ts` — `verifyRegistryActor`,
    `redactSensitiveActorSnapshot`, and the `RegistryActorContext` type.
  - `scripts/migrations/operations-registry-inventory.lib.ts` —
    `STATIC_AUTHORITY_REFERENCES`, `collectInventoryCollisions`,
    `assertNoApplyFlag`, `assertInventoryDatabaseAllowed`.
  - `src/services/operationsRegistry/queries/health.ts` — finding shape and the
    existing `registry.compatibility_reads_remaining` seam.

## 2. Objective

Make a Feed the only destination a sheet or legacy label can resolve to, through
one audited collection with an exact, namespaced, collision-free match. Switch
the sheet/legacy read path to collection-first with an **instrumented** static
fallback, so that specification §9.7's "compatibility reads reach zero" becomes
a measurable Registry Health number rather than an assumption.

Deliver the report half of §9.1–9.2 as well: an inventory of every static label
and a usage report for the embedded `LeadSourceCompany.granularities[]`.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server` only. No Admin work in this pass.
- **Branch:** the pack branch (proposed `operations-registry-source-connections`),
  confirmed by the Owner at kickoff.
- **Prerequisites:** none. Startable immediately, in parallel with ORS-2.
- **Shared-file discipline with ORS-2:** you both touch
  `queries/health.ts` and `v1.routes.ts`. Append your findings at the end of the
  health assembly and mount your routes as a contiguous block; do not reorder or
  reformat existing entries.
- Ordinary checks use redacted synthetic data. Runtime reads require
  `TEST_MODE=true` and `testvantagemovers`.
- No commit, push, deploy, production flag change, production index apply, live
  payload read, or external send.

## 4. Current-state evidence to verify

Observed 2026-08-24; **reverify at implementation**.

- `src/models/LeadSourceLabelMapping.ts` does not exist. No
  `lead_source_label_mappings` collection exists.
- `src/config/domain/sources.ts` is 280 lines. It exports `SOURCE_COMPANIES`,
  `CRM_SOURCE_LABELS`, and `SOURCE_LABEL_TO_COMPANY` (a label → **company**
  map — it cannot express Feed-level attribution, which is the whole problem).
  It deliberately reads no `process.env`.
- Live / seed importers of `SOURCE_LABEL_TO_COMPANY` as of 2026-09-01 reverify:
  `src/services/analytics/analyticsFilters.ts` (reporting — leave on the static
  map), `src/services/leadSourceCompanies/leadSourceCompany.service.ts` (seed
  aliases only), `src/services/ringcentral/call-lead-sources.ts` (M5 / fixture
  seed re-export; not a runtime write path). `resolveSourceCompanyFromLabel`
  is also called from `resolveSourceCompany` (company-slug resolution),
  `src/services/granotHttpCollector/granotFormLeadMatcher.ts`, and
  `src/services/reconciliation/bookedCallLeadRows.ts`.
- **Drift from 2026-08-24:** `sourceHierarchy.ts` imports `SOURCE_COMPANY_CONFIGS`
  only. `cplRate.service.ts` imports the `SourceCompany` type only (its
  compatibility telemetry is `legacy_cpl_rates`). `formLeadPayload.ts` does not
  import the static map. Script importers remain:
  `scripts/dump-operations-name-link-inventory.ts`,
  `scripts/historical/audit-consolidation-databases.ts`,
  `scripts/migrations/dump-operations-registry-seed-surface.ts`,
  `scripts/migrations/operations-registry-inventory.lib.ts`.
- `sourceResolution.ts` exports `previewSourceAttribution`,
  `RegistrySourceCompanyRecord`, `RegistrySourceGranularityRecord`,
  `SourceAttributionInput`, `SourceAttribution`, `SourceResolutionPreview`. Its
  private `normalize()` (line ~283) does `trim().toLowerCase()` **only**.
- **Finding:** that `normalize()` performs no NFKC normalization and no internal
  whitespace collapse, which specification §3.4 requires. Do not reuse it for
  mapping keys; see §5.
- `queries/health.ts` already emits `registry.compatibility_reads_remaining`
  (line ~416) and `registry.source_resolution_failures` (line ~357). Reuse both
  rather than adding parallel counters.
- The actor type is named `RegistryActorContext` in
  `src/services/operationsRegistry/types.ts:10`. The specification's §3.3 sketch
  says `RegistryActorSnapshot`; **use the real type name** and note the
  divergence in your completion report.
- `scripts/migrations/operations-registry-inventory.lib.ts` already models
  `StaticAuthorityReference`, `GranularityInventoryRecord`,
  `SourceCompanyInventoryRecord`, `collectInventoryCollisions`, and
  `computeInventoryChecksum`. `pnpm migrations:operations-registry-inventory`
  exists in `package.json`. ORS-1 extends this file; it does not add a second
  inventory. Manifest checksums reuse the same `hashInventoryValue` primitive
  that `computeInventoryChecksum` uses.

## 5. Locked decisions and invariants at risk

- **The Feed is the destination; the Lead Source is derived.** A mapping stores
  both IDs, but `source_granularity` is authoritative and `source_company` is a
  redundant integrity snapshot. Reads resolve the Feed first and derive its Lead
  Source. Never resolve to a company and then guess a Feed.
- **Exact match only.** Normalization is NFKC → collapse internal whitespace to
  a single space → trim → lowercase, applied **server-side** on write and on
  read. No fuzzy matching anywhere in the runtime path. Write this as one
  exported function and use it on both sides; a second implementation is how the
  two sides drift apart.
- **Namespaced uniqueness.** Unique index on active
  `{ namespace, normalized_label }`. Two active mappings for the same normalized
  label in the same namespace is a blocking condition, not a tiebreak.
- **No in-place destination edit.** Correcting a mapping means deactivating it
  and creating a replacement. History stays reviewable. `source_company`,
  `source_granularity`, `label`, and `namespace` are immutable after create.
- **Fail closed.** Zero matches or multiple matches is an operational finding
  and stops automatic attribution. It does not fall through to a company-level
  guess.
- **The static map is not deleted in this pass.** It becomes a fallback that
  emits a durable compatibility-read event on every use. Deleting it here would
  destroy the evidence §9.7 requires.
- **Do not put sheet labels in `aliases[]`.** Specification §3.3 is explicit.
- Feed activation stays fail-closed exactly as it is today (§3.2). This pass
  changes no activation rule.

## 6. Deliverables and exact contract

### 6.1 `src/models/LeadSourceLabelMapping.ts`

```ts
type LeadSourceLabelMapping = {
  label: string;                  // exact raw label as received
  normalized_label: string;       // server-derived; never client-supplied
  namespace: "sheet_lead_source" | "legacy_api_source";
  source_company: ObjectId;       // immutable; redundant integrity snapshot
  source_granularity: ObjectId;   // immutable; authoritative destination
  active: boolean;
  created_by: RegistryActorContext;
  change_reason?: string;
  archived_at?: Date;
};
```

Indexes:

| Index | Kind | Purpose |
| --- | --- | --- |
| `{ namespace: 1, normalized_label: 1 }` partial on `active: true` | unique | The collision rule |
| `{ source_granularity: 1, active: 1 }` | non-unique | Per-Feed label lists for ORS-3 |
| `{ source_company: 1, active: 1 }` | non-unique | Integrity sweep |

Schema-level validation rejects a `normalized_label` that does not equal
`normalizeSourceLabel(label)`, and rejects any post-create change to `label`,
`namespace`, `source_company`, or `source_granularity`.

### 6.2 `src/services/operationsRegistry/labelMappings.ts`

```ts
export function normalizeSourceLabel(raw: string): string;

export async function createLabelMapping(
  command: CreateLabelMappingCommand,
  actor: RegistryActorContext,
): Promise<LabelMappingRecord>;

export async function setLabelMappingActivation(
  id: string,
  active: boolean,
  reason: string,
  actor: RegistryActorContext,
): Promise<LabelMappingRecord>;

export async function listLabelMappings(
  filter: { source_company?: string; source_granularity?: string; namespace?: string },
): Promise<LabelMappingRecord[]>;

export async function resolveLabelToFeed(
  namespace: LabelNamespace,
  rawLabel: string,
): Promise<LabelResolution>;
```

`LabelResolution` is a discriminated union — `{ status: "resolved"; ... }`,
`{ status: "not_found" }`, `{ status: "ambiguous"; candidates: ... }` — mirroring
`SourceResolutionPreview`. It never throws for a miss; a miss is data.

Create validates, in order and before any write: the Feed exists; the Feed
belongs to the submitted Lead Source; the Feed is active; no active mapping
already holds `{ namespace, normalized_label }`. A mismatched company/Feed pair
is rejected, never silently corrected. `change_reason` is required, 10–1000
characters. Every mutation goes through `registryAudit.ts`.

### 6.3 Collection-first resolution with instrumented fallback

Rewire the sheet/legacy read path to specification §5.1:

```text
raw label → normalize within namespace → exactly one active mapping
          → active Feed → derive active Lead Source
          → write IDs + current label snapshots to the Lead
```

The static map in `config/domain/sources.ts` is consulted **only** when the
collection returns `not_found`, and every such consultation emits a durable
compatibility-read event carrying the namespace, the raw label, the caller, and
a timestamp. Wire that counter into the existing
`registry.compatibility_reads_remaining` finding.

`not_found` with no fallback hit, and `ambiguous` in any case, fail closed for
automatic attribution and raise `registry.source_resolution_failures`.

Touch only the sheet/legacy attribution seam. `analyticsFilters.ts`,
`sourceHierarchy.ts`, and `cplRate.service.ts` are reporting/pricing consumers —
leave them on the static map and list them in your report as remaining
compatibility consumers.

### 6.4 Routes

Mounted in `v1.routes.ts` as one contiguous block, matching the existing admin
route style and error envelope. Validation in
`src/validation/v1/sourceLabelMappings.validation.ts`; unknown keys reject.

```text
POST  /api/v1/admin/source-label-mappings
PATCH /api/v1/admin/source-label-mappings/:id/activation
GET   /api/v1/admin/source-label-mappings?source_company=&source_granularity=&namespace=
POST  /api/v1/admin/source-label-resolution/preview
```

`normalized_label` is derived server-side. A client that submits one is
rejected, not silently overridden. The preview route is read-only and writes
nothing — it is the surface ORS-4's Owner form uses to confirm a suggestion.

### 6.5 Health findings

Append to `queries/health.ts`:

| Code | Condition |
| --- | --- |
| `registry.label_mapping_destination_invalid` | Active mapping whose Feed or Lead Source is missing, inactive, or whose Feed does not belong to the stored Lead Source |
| `registry.label_mapping_collision` | Two active mappings share `{ namespace, normalized_label }` — should be impossible under the unique index; if it fires, the index is missing |

`registry.compatibility_reads_remaining` must now be fed by the real counter
from §6.3, not a placeholder.

### 6.6 Migration script — report first

`scripts/migrations/operations-registry-label-mappings.ts`, run as
`pnpm migrations:operations-registry-label-mappings`. **Extend**
`operations-registry-inventory.lib.ts`; do not write a second inventory.

Three modes:

1. `--report` (default) — inventory every static label, Feed `crm_label` and
   alias, observed sheet value, and stored Lead snapshot; propose one mapping
   per label; classify each as `ok`, `zero_match`, `multiple_match`, or
   `cross_company`. **Stop on any of the last three** — do not emit a manifest
   containing a guess.
2. `--manifest` — emit a deterministic, checksummed manifest of `ok` proposals,
   reusing `computeInventoryChecksum`.
3. `--apply --manifest=<path>` — apply exactly that checksummed manifest inside
   registry audits. Guarded by `assertInventoryDatabaseAllowed`.

Also emit the §9.2 report: every read and write of the embedded
`LeadSourceCompany.granularities[]`, its three indexes, and whether any live
code path still reads it. **Report only. Remove nothing.**

## 7. Explicitly out of scope

- Any deletion from `config/domain/sources.ts`, any removal of embedded
  `granularities[]`, any index drop. Specification §9.8, separately reviewed,
  after the observation window.
- Everything Granot: `GranotCrmSource`, `lead_created`, policies, SMS,
  `daily_cap` — ORS-2.
- The aggregate Lead Source projection, `lead-source-setups`, and RingCentral
  DTO enrichment — ORS-3.
- All Admin/UI work and all Owner copy — ORS-4. This pass ships no `vantage-admin`
  change.
- Migrating `analyticsFilters.ts`, `sourceHierarchy.ts`, or `cplRate.service.ts`
  off the static map. Report them; do not move them.
- Any change to Feed activation rules or CPL validation.

## 8. Flags and runtime posture

- **No new feature flag.** The collection-first path is the path; the static map
  is a fallback, not an alternative mode. A flag here would let the two
  authorities diverge silently, which is the failure this pass exists to end.
- The compatibility-read counter must work with an empty
  `lead_source_label_mappings` collection — day one is 100% fallback, and that
  reading correctly in Registry Health is a test, not a caveat.

## 9. Migration and indexes

Three indexes from §6.1, all additive; the unique one is partial on
`active: true` so archived rows never collide. Report on `testvantagemovers`
first, apply explicitly second. **No production index apply is authorized.**

## 10. Acceptance criteria

- [x] `normalizeSourceLabel` is one exported function used by both the write and
      read paths; NFKC, whitespace collapse, trim, and lowercase each have a
      named test, including a full-width and a non-breaking-space case.
- [x] Creating a second active mapping for the same `{ namespace, normalized_label }`
      is rejected by the service **and** by the unique index, proven separately.
- [x] Creating a mapping whose Feed belongs to a different Lead Source than the
      one submitted is rejected; the error names both.
- [x] A client-supplied `normalized_label` is rejected, not overridden.
- [x] `change_reason` shorter than 10 or longer than 1000 characters is rejected.
- [x] There is no code path that edits a mapping's destination in place;
      correction is deactivate + create, and the archived row survives.
- [x] A label with exactly one active mapping resolves to that Feed and derives
      its Lead Source, with **no** consultation of the static map.
- [x] A label with no mapping falls back to the static map, emits exactly one
      durable compatibility-read event, and increments
      `registry.compatibility_reads_remaining`.
- [x] A label with an inactive-Feed mapping fails closed and raises
      `registry.source_resolution_failures`. It does not fall back.
- [x] An active mapping pointed at an inactive Feed produces
      `registry.label_mapping_destination_invalid` in Registry Health.
- [x] `--report` on a fixture containing one `cross_company` label exits without
      emitting a manifest and names the offending label.
- [x] `--apply` refuses a manifest whose checksum does not match its content.
- [x] The §9.2 report lists every reader of embedded `granularities[]`, and
      nothing in this pass removed it.
- [x] Every mapping mutation appears in the registry audit trail with the actor
      and the reason.
- [x] Registry Health renders correctly with an empty mappings collection.

## 11. Required tests and commands

```bash
pnpm test
pnpm typecheck
pnpm migrations:operations-registry-label-mappings            # report mode only
```

Focused tests:

- `src/services/operationsRegistry/labelMappings.test.ts` — normalization table,
  create validation order, collision, immutability, deactivate-and-replace.
- `src/services/operationsRegistry/sourceResolution.test.ts` — extend with
  collection-first hit, fallback hit + event emission, ambiguous fail-closed,
  inactive-Feed fail-closed. The "resolves without touching the static map" case
  is a named test asserting the static map was **not** read, not an assertion
  buried in a fixture.
- `src/services/operationsRegistry/queries/health.test.ts` — both new findings,
  plus the empty-collection case.
- `src/routes/…` route test — validation rejection of unknown keys and of
  client-supplied `normalized_label`, error-envelope parity with the existing
  admin routes.

Record the report-mode output verbatim in the completion report, including the
counts per classification.

## 12. Live/staging verification

Preview deploy against `TEST_MODE` and `testvantagemovers`. Verify: a seeded
mapping resolves; an unseeded label falls back and the compatibility counter
increments in `/operations-registry/health`; an ambiguous seed fails closed.
Capture deployment ids.

**No production deploy, no production index apply, no live payload read.**

## 13. Rollback

The collection is additive and the static map is untouched, so rollback is
ordered and cheap: unmount the four routes, then revert the resolver to
static-first. The `lead_source_label_mappings` documents can stay — nothing
reads them once the resolver is reverted. The three indexes are additive; leave
them. No existing data was rewritten.

## 14. Required completion handoff

Report: files added and changed; the three index definitions and their
collision-report output; `--report` classification counts verbatim; the §9.2
embedded-`granularities[]` reader list; the remaining static-map consumers you
deliberately did not migrate; the `RegistryActorContext` vs `RegistryActorSnapshot`
naming divergence; test and typecheck output; preview deployment ids; and
explicit confirmation that nothing was removed from `config/domain/sources.ts`.

Then update [`../PROGRESS.md`](../PROGRESS.md): tick §3.1, §3.2, §3.3, §5.1,
§6.2, §8 (label mappings), §9.1–9.2, §9.3–9.5, and criteria 6 and 12; set ORS-1
`complete`; and if ORS-2 is already `complete`, move ORS-3 to `ready`.

**Unblocks:** ORS-3 (jointly with ORS-2).
