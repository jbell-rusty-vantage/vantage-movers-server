# Fold This Historical Bag Into One Stable String, Stamp SHA-256 Of The Raw String Or The Fold, Mint A 24-Hex ObjectId From Namespace Plus NUL Plus Natural Key, Then Prove The Sealed Manifest Body Still Matches manifest_hash — Never Seal A Durable-Work Envelope, Never Write Mongo, Never Plan A Booking — operational story

- Status: recommended
- Service: `historicalConsolidation` (Wave A, in-progress)
- Pass: 13 of this service — `stableJson.ts`
- Remaining in this service: `mongoValues.ts`
- Target: `src/services/historicalConsolidation/stableJson.ts`
- Knowledge: none for this folder. The hardening plan is [`historical-consolidation-final-hardening-and-pre-run-implementation-plan.md`](../../../docs/index.md) (Immutable manifest requirements: use canonical stable JSON and SHA-256; stamp deterministic operation IDs and deterministic ObjectId mappings; apply must refuse a manifest if its bytes, evidence hashes, rule version, decisions, code SHA, target preconditions, or database identity have changed). Staged-merge spec: [`historical-consolidation-rules-and-staging-spec.md`](../../../docs/index.md) (Acceptance: same inputs / rules / decisions are byte-equivalent; conflict `case_id` / `evidence_hash` cover canonical identity plus evidence). Already-recommended siblings: [historical-consolidation-classification.md](historical-consolidation-classification.md) (planner hashes **this** file’s `sha256(FORM_DUPLICATE_CUTOFF.toISOString())` — classification does **not** import this file), [historical-consolidation-planner.md](historical-consolidation-planner.md) (**asks** `sha256` for snapshot / policy / Form / Call identity / booking facts / unique sales / conflict `case_id` / `evidence_hash` / `equalValue`; **asks** `deterministicObjectId` for inactive catalog, Job-Number Customer, Booking, Cancellation, registry-audit), [historical-consolidation-manifest.md](historical-consolidation-manifest.md) (**asks** `sha256` for `operation_id` / `manifest_id` / `decision_bundle_hash` / `manifest_hash`; **asks** `assertArtifactHash` and the `stableJson` fixed-point on parse), [historical-consolidation-apply.md](historical-consolidation-apply.md) (**asks** `assertArtifactHash` then `sha256` of hello-set fingerprint and `comparable` collection checksums), [historical-consolidation-verify.md](historical-consolidation-verify.md) / [historical-consolidation-rollback.md](historical-consolidation-rollback.md) (**ask** `assertArtifactHash` only). Distinct from leftover `mongoValues.ts` (`$oid` / `$date` materialize and `comparable` — apply checksums **ask** `comparable` first, then this file’s `sha256`). Distinct from already-recommended [durable-work-checksum.md](durable-work-checksum.md) (`canonicalJson` **refuses** `undefined` / functions / circles / class instances, then stamps `{ checksum_version, artifact_kind, schema_version, payload }`; prove is timing-safe and does **not** echo hex). Distinct from already-recommended [domain-commands-existing-write-context.md](domain-commands-existing-write-context.md) (private `stableJson` drops `undefined` and does **not** throw on Infinity; never **asks** this file). Distinct from Granot lifecycle `normalization.ts` local `stableJson` and from live `src/utils/objectId.ts` `newObjectIdHex` (random 24-hex, not namespaced). Distinct from `ingest-historical-sheets.ts` (the write-capable row-by-row upsert the spec forbids becoming the planner *or* this fold). `package.json` still names `pnpm historical:plan`; the staged-merge script folder is **absent** from this checkout. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — do not invent “Historical Canonical JSON” copies. `docs/adr/` is absent here — do not invent ADR copies. Do not add a Historical Consolidation Service in this rename.
- Callers: **already-recommended planner, sealer, apply, verify, rollback, the barrel, and the planner fixture.** `planner.ts` imports `deterministicObjectId` and `sha256` from this file (not the barrel). `manifest.ts` imports `assertArtifactHash`, `sha256`, `stableJson`. `apply.ts` imports `assertArtifactHash`, `sha256`. `verify.ts` / `rollback.ts` import `assertArtifactHash` only. Barrel `historicalConsolidation/index.ts` re-exports all four. Folder `planner.test.ts` **asks** `sha256` to mint `snapshot.snapshot_hash` before `planHistoricalConsolidation` — that mint is this **interface**; the rest of the fixture is the planner **interface**. Folder `manifest.test.ts` **asks** `parseHistoricalManifest`, which **asks** `assertArtifactHash` as a sibling **ask** — hash mismatch through parse is **not** this **interface**. There is no `stableJson.test.ts`. Scripts in this checkout do **not** import this file. Not this **interface**: `planHistoricalConsolidation`, `buildHistoricalManifest`, `parseHistoricalManifest`, `preflightHistoricalManifest`, `applyHistoricalManifest`, `verifyHistoricalManifest`, `rollbackHistoricalManifest`, `comparable` / `materializeMongoValue`, `canonicalJson` / `computeChecksum` / `assertChecksum`, `hashExistingWritePayload`, `newObjectIdHex`.
- Seams callers need: fold-only (`stableJson`) vs stamp (`sha256`) vs 24-hex mint (`deterministicObjectId`) vs prove (`assertArtifactHash`); raw-string hash vs folded-bag hash; drop-`undefined` vs durable-work refuse-`undefined`; this body-only `manifest_hash` vs durable-work versioned envelope; 64-hex planner identity vs 24-hex Mongo `_id`. There is no begin / complete Domain Command **seam**. There is no live Form / Booking **adapter**. There is no Mongo write **adapter**. There is no `$oid` **adapter**. There is no HTTP **adapter**. There is no filesystem **adapter**.
- Split later (only if the file outgrows one sitting): this ~39-line file is one sitting if you read it as fold this bag, stamp it, mint the 24-hex id, then prove the sealed body. If it later splits by **story**: do not. One fold plus one stamp plus one mint plus one prove. Never `create.ts` / `update.ts` / `delete.ts` / `hash.ts` / `json.ts`. Planner identity, sealer operation ids, apply fingerprints, `$oid` materialize, durable-work envelopes, and Domain Command payload hashes stay siblings / other services.

`stableJson` / `sha256` / `deterministicObjectId` / `assertArtifactHash` are executor mechanics. The owner question is: *The planner or sealer already has a bag. Fold it so key order and Date vs ISO cannot change the stamp. Drop keys whose value is `undefined`. Refuse Infinity. Hash the fold — or the raw UTF-8 string if the caller already handed you bytes. Mint a 24-hex ObjectId from a namespace, a NUL, and the natural key so inactive catalog / Job-Number Customer / Booking / Cancellation inserts stay the same across replans. Later, pull `manifest_hash` off the sealed artifact and prove the remaining body still hashes. This file does not seal a durable-work envelope. This file does not write Mongo. This file does not plan a Booking.*

Who walks the sheets, who seals operation ids, who materializes `$oid`, and who stamps durable-work envelopes already live in other **modules**. Do not pull those in.

## What this file actually does

Four “fold, stamp, mint, prove” stories in one sitting, not “a JSON helper,” and not Plan This Historical Merge / Seal This Historical Manifest / Materialize This `$oid` / Seal This Durable-Work Envelope:

1. **Fold this historical bag into one stable string** — `stableJson(value)`. Walk `canonicalize`: a `Date` becomes `toISOString()`; an array keeps index order; an object drops `undefined` entries, sorts remaining keys with `localeCompare` (no locale argument), then walks each value. A non-finite number throws `"Canonical JSON cannot contain non-finite numbers"`. Then `JSON.stringify`. Already-recommended `parseHistoricalManifest` **asks** this beat as a fixed point (`stableJson(parsed) === stableJson(JSON.parse(stableJson(parsed)))`). `sha256` **asks** this beat when the argument is not already a string. This beat does **not** hash. This beat does **not** refuse `undefined` the way `canonicalJson` does — it drops the key. This beat does **not** detect circles or class instances.

2. **Stamp this historical bag as SHA-256 hex** — `sha256(value)`. A string is hashed as UTF-8 bytes with **no** extra JSON quotes. Anything else is folded first, then hashed. Returns lowercase hex. Already-recommended planner **asks** this beat for `historical_snapshot_hash` / live snapshot hash, `source_mappings` / `aliases` / `form_duplicate_cutoff` policy hashes, Form identity (`{ kind: "form", company, lid, phone, timestamp, provenance }`), Call identity (`{ kind: "call", granularity, phone, timestamp, provenance }`), incompatible booking-fact keys, unique-sale keys, conflict `case_id` / `evidence_hash`, and `equalValue`. Already-recommended sealer **asks** it for `operation_id`, omitted `manifest_id` (`historical-` plus first 32 hex), `decision_bundle_hash`, and `manifest_hash`. Already-recommended apply **asks** it for `{ setName, hosts }` and for each target collection after `comparable`. Folder `planner.test.ts` **asks** it to mint `snapshot_hash`. This beat does **not** wrap a `checksum_version` envelope. This beat does **not** mint a 24-hex ObjectId.

3. **Mint this 24-hex historical ObjectId from namespace plus NUL plus natural key** — `deterministicObjectId(namespace, naturalKey)`. `sha256(`${namespace}\u0000${naturalKey}`).slice(0, 24)`. Already-recommended planner **asks** this beat with load-bearing namespaces: `historical-source-company`, `historical-source-granularity`, `historical-agent`, `historical-merchant`, `historical-registry-audit`, `historical-${collection}` for Form / Call inserts (natural key is the 64-hex planner `id`), `historical-job-customer`, `historical-booking`, `historical-cancellation`. This beat does **not** **ask** `newObjectIdHex`. This beat does **not** write Mongo. This beat does **not** validate the hex as a timestamp-prefixed ObjectId.

4. **Prove this sealed historical manifest body still hashes to `manifest_hash`** — `assertArtifactHash(artifact)`. Pull `manifest_hash` off the top level. Stamp the rest. Mismatch throws ``Manifest hash mismatch: expected ${manifest_hash}, calculated ${actual}``. Already-recommended `parseHistoricalManifest`, `preflightHistoricalManifest`, `applyHistoricalManifest`, `verifyHistoricalManifest`, and `rollbackHistoricalManifest` each **ask** this beat on an in-memory object. This beat does **not** open bytes. This beat does **not** compare timing-safe. This beat does **not** trim or lowercase the stored hex before `!==`.

There is no fifth plan, seal, or `$oid` operation. Local `canonicalize` is a fold inside stories 1–2.

## Organization

Keep one file. This is the screenplay for “fold this historical bag, stamp it, mint the 24-hex id, then prove the sealed body.” Sheet walk and identity already live on already-recommended `planner.ts`. Operation-id and `manifest_hash` planting already live on already-recommended `manifest.ts`. `$oid` / `$date` already live on `mongoValues.ts`. The durable-work envelope already lives on already-recommended `checksum.ts`. Domain Command payload hash already lives on already-recommended `existingWriteContext.ts`. Do not pull those in. Do not invent a `HistoricalStableJsonService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a durable-work envelope **adapter** so “one hash owns the company.” Do not invent a Mongo **adapter** so “the mint writes `_id`.” Do not invent an HTTP **adapter** so “a route can hash a bag.” Do not invent a CRUD folder so “fold / stamp / mint / prove each get a file.”

Do not move `sha256` into `planner.ts` so “the planner owns identity.” Do not merge this into `canonicalJson` so “one fold owns live and historical.” Do not merge this into `newObjectIdHex` so “one ObjectId owns every insert.” Do not split `create.ts` / `update.ts` / `delete.ts` / `hash.ts` / `json.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `stableJson` | `foldThisHistoricalBagIntoOneStableString` | parse must prove bytes are a fixed point; stamp **asks** the fold when the value is not already a string |
| `sha256` | `stampThisHistoricalBagAsSha256` | planner / sealer / apply must lock identity and checksums without a durable-work envelope |
| `deterministicObjectId` | `mintThis24HexHistoricalObjectIdFromNamespaceAndNaturalKey` | inactive catalog / Job-Number Customer / Booking / Cancellation inserts must replay the same `_id` |
| `assertArtifactHash` | `proveThisHistoricalManifestBodyStillHashesToManifestHash` | parse / apply / verify / rollback must refuse a moved body |

Keep the old names as one-line aliases until already-recommended `planner.ts`, `manifest.ts`, `apply.ts`, `verify.ts`, `rollback.ts`, `planner.test.ts`, and the barrel migrate. Do not make callers learn `createHash("sha256")` / `localeCompare` / `\u0000` as the domain language. Do **not** export `canonicalize` from here. Do **not** put `sha256` onto a live Booking route so “HTTP can stamp a bag.” Do **not** rename throw strings (`Canonical JSON cannot contain non-finite numbers`, `Manifest hash mismatch: expected …, calculated …`). Do **not** rename namespaces (`historical-source-company`, `historical-source-granularity`, `historical-agent`, `historical-merchant`, `historical-registry-audit`, `historical-form_leads` / `historical-call_leads` via ``historical-${collection}``, `historical-job-customer`, `historical-booking`, `historical-cancellation`). Do **not** rename `manifest_hash`. Do **not** replace `\u0000` with `:` so “the separator is printable.”

**No workflow class.** The one type that *does* earn a name is the sealed artifact card callers already pass into prove:

```ts
type ThisHistoricalSealedArtifact = { manifest_hash: string } & Record<string, unknown>
```

That is today’s `assertArtifactHash` generic — the handoff from “the sealer planted `manifest_hash`” to “prove the body has not moved.” Do **not** add `checksum_version` / `artifact_kind` onto this card so “durable-work can share the envelope.” Do **not** add `session` or a Booking id onto `deterministicObjectId` so “the mint writes Mongo.”

Leave plan on already-recommended `planner.ts`. Leave `$oid` on `mongoValues.ts`. Leave `canonicalJson` on already-recommended `checksum.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// stableJson.ts
// The planner or sealer already has a bag.
// Fold it so key order and Date vs ISO cannot change the stamp.
// Drop undefined keys. Refuse Infinity.
// Hash the fold — or the raw string if the caller already handed you bytes.
// Mint a 24-hex ObjectId from namespace, NUL, and the natural key.
// Later prove the sealed body still hashes.
// Do not seal a durable-work envelope.
// Do not write Mongo.
// Do not plan a Booking.

// ── 1. Fold this historical bag into one stable string ──

export function foldThisHistoricalBagIntoOneStableString(value: unknown): string
function dropUndefinedKeysThenSortTheRestByLocaleCompare(value)
function refuseThisHistoricalBagWhenANumberIsNotFinite(value)

// ── 2. Stamp this historical bag as SHA-256 ──

export function stampThisHistoricalBagAsSha256(value: unknown): string
function hashTheseUtf8BytesWhenTheCallerAlreadyHandedAString(value: string)
function foldThenHashWhenTheCallerHandedABag(value: unknown)

// ── 3. Mint this 24-hex historical ObjectId ──

export function mintThis24HexHistoricalObjectIdFromNamespaceAndNaturalKey(
  namespace: string,
  naturalKey: string,
): string
function joinThisHistoricalNamespaceToTheNaturalKeyWithANul(namespace, naturalKey)

// ── 4. Prove this sealed historical manifest body still hashes ──

export function proveThisHistoricalManifestBodyStillHashesToManifestHash(
  artifact: ThisHistoricalSealedArtifact,
): void
function pullManifestHashOffTheTopLevelAndStampTheRest(artifact)
```

Read the primary path out loud: *Fold this historical bag so key order and Date vs ISO cannot change the stamp. Drop keys whose value is `undefined`. Refuse Infinity. Hash the fold — or the raw UTF-8 string if the caller already handed you bytes. Mint a 24-hex ObjectId from a namespace, a NUL, and the natural key so inactive catalog / Job-Number Customer / Booking / Cancellation inserts stay the same across replans. Later pull `manifest_hash` off the sealed artifact and prove the remaining body still hashes. Do not seal a durable-work envelope. Do not write Mongo. Do not plan a Booking.*

That is the operation. `stableJson` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This fold drops `undefined`; durable-work refuses it.** `canonicalJson({ secret: undefined })` throws. This file omits the key and stamps `{}`. Do not route `stableJson` through `canonicalJson` so “one fold owns the company” — existing planner / sealer hashes would move.

2. **Key sort is `localeCompare` with no locale.** Durable-work uses UTF-16 `Object.keys().sort()`. Two machines with different default locales can disagree on non-ASCII keys. Do not swap to UTF-16 in this rename without an **interface** proof that today’s fixtures still hash.

3. **Domain Command `existingWriteContext` is a near copy that does not throw on Infinity.** Same Date / drop-`undefined` / sort walk. Do not import this file from `hashExistingWritePayload` so “one stamp owns every command.”

4. **`sha256` string passthrough is load-bearing.** `sha256(FORM_DUPLICATE_CUTOFF.toISOString())` hashes the raw ISO text. `sha256({ cutoff: thatString })` would quote it. `deterministicObjectId` **asks** the string path (`namespace` + NUL + key). Do not fold strings so “every argument is JSON.”

5. **Planner identity is 64 hex; Mongo `_id` is 24 hex.** Form / Call `id = sha256({ kind, … })`. Insert `_id` is `deterministicObjectId("historical-${collection}", lead.id)`. Do not slice the Form hash to 24 so “one id owns both.”

6. **`assertArtifactHash` echoes both hexes and is not timing-safe.** Durable-work `assertChecksum` trims / lowercases and uses `timingSafeEqual`. Do not swap this throw in this rename — `manifest.test.ts` matches `/hash mismatch/` through `parseHistoricalManifest`.

7. **`stableJson(undefined)` is not a string.** `JSON.stringify(undefined)` returns JavaScript `undefined`. Callers today pass objects or strings. Do not “fix” the return type by hashing `"null"` in this rename.

8. **There is no `stableJson.test.ts`.** `planner.test.ts` **asks** `sha256` only to mint `snapshot_hash`. `manifest.test.ts` **asks** parse. Do not treat those fixtures as this **interface**.

9. **Leave sibling modules and live writes alone.** `planHistoricalConsolidation`, `buildHistoricalManifest`, `comparable`, `canonicalJson`, `hashExistingWritePayload`, `newObjectIdHex`, and `ingest-historical-sheets.ts` are not this file. Do not inline them so “the fold is one sitting.”

## Testing

The **interface** is the test surface: `foldThisHistoricalBagIntoOneStableString`, `stampThisHistoricalBagAsSha256`, `mintThis24HexHistoricalObjectIdFromNamespaceAndNaturalKey`, `proveThisHistoricalManifestBodyStillHashesToManifestHash` (today `stableJson`, `sha256`, `deterministicObjectId`, `assertArtifactHash`).

There is no `stableJson.test.ts`. `planner.test.ts` through `planHistoricalConsolidation` is **not** this **interface** except the one `sha256(snapshotBody)` mint. `manifest.test.ts` through `parseHistoricalManifest` is **not** this **interface**.

Add only what this **interface** still hides. Do **not** point `planHistoricalConsolidation` at live `vantagemovers` from this fixture.

**Fold this historical bag into one stable string**
- `{ b: 1, a: 2 }` equals `{ a: 2, b: 1 }` (key order cannot change the fold).
- A `Date` folds to the same string as its ISO text inside a bag.
- `{ keep: 1, drop: undefined }` equals `{ keep: 1 }` (`undefined` is dropped, not refused).
- `Number.POSITIVE_INFINITY` throws `"Canonical JSON cannot contain non-finite numbers"`.
- Do **not** require `canonicalJson` as this beat.

**Stamp this historical bag as SHA-256**
- Same folded bags stamp the same 64 hex.
- `sha256("2026-04-30T04:00:00.000Z")` is not `sha256(JSON.stringify("2026-04-30T04:00:00.000Z"))` (string passthrough).
- Do **not** require `computeChecksum` as this beat.
- Do **not** require `planHistoricalConsolidation` as this beat.

**Mint this 24-hex historical ObjectId**
- `deterministicObjectId("historical-agent", "alice")` is 24 lowercase hex and equals `sha256("historical-agent\u0000alice").slice(0, 24)`.
- Same namespace + key replays the same id; a different namespace does not.
- Do **not** require `newObjectIdHex` as this beat.

**Prove this sealed historical manifest body still hashes**
- `{ a: 1, manifest_hash: sha256({ a: 1 }) }` returns void.
- A moved body throws `/Manifest hash mismatch/`.
- Do **not** require `parseHistoricalManifest` as this beat.
- Do **not** require `assertChecksum` as this beat.

Do **not** add a test per helper (`dropUndefinedKeysThenSortTheRestByLocaleCompare`, `joinThisHistoricalNamespaceToTheNaturalKeyWithANul`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

The four function names may stay exported as aliases. They are the test surface. Do **not** export a durable-work envelope so “the fixture owns live plans.”

## What I would not do

- A `HistoricalStableJsonService` class with `hash` / `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `JSON.stringify` / `createHash("sha256")`.
- Moving this into a CRUD folder, or a `hash/` folder that also swallows `planner.ts`, `manifest.ts`, `mongoValues.ts`, and `durableWork/checksum.ts`.
- Splitting `create.ts` / `update.ts` / `delete.ts` / `hash.ts` / `json.ts`.
- Treating `planHistoricalConsolidation`, `buildHistoricalManifest`, `comparable`, `canonicalJson`, `hashExistingWritePayload`, `newObjectIdHex`, or `ingest-historical-sheets.ts` as this story.
- Inventing a Domain Command **seam** that has only this fold as an **adapter**.
- Inventing a durable-work envelope **adapter** so “one hash owns the company.”
- Inventing a Mongo **adapter** so “the mint writes `_id`.”
- Inventing an HTTP **adapter** so “a route can hash a bag.”
- Routing `stableJson` through `canonicalJson` so “undefined is refused everywhere.”
- Folding strings so “every `sha256` argument is JSON.”
- Slicing Form / Call `sha256` identity to 24 so “one id owns both.”
- Renaming namespaces or the NUL separator so “the id is prettier.”
- Opening `mongoValues.ts` in this pass, or writing a whole-folder recommendation for `historicalConsolidation`.
