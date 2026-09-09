# Seal This Immutable Artifact — Fold The Bag Into One Stable String, Stamp SHA-256 Of The Versioned Envelope, And Later Prove The Stored Hex Still Matches — Refuse Undefined Infinity Circles And Class Instances — Never Pick A Plan, Never Persist The Hex, Never Hash A Domain Command Through This Envelope — operational story

- Status: recommended
- Service: `durableWork` (Wave A, in-progress)
- Pass: 2 of this service — `checksum.ts`
- Remaining in this service: `actors.ts`, `checkpoints.ts`, `capability.ts`, `schema.ts`, `providerRetry.ts`, `runTransitions.ts`, `testing.ts`
- Target: `src/services/durableWork/checksum.ts`
- Knowledge: none for this folder. Callers already have Services: [`docs/knowledge/services/ingestion.md`](../../../docs/knowledge/services/ingestion.md) (Owner approve binds `plan_checksum`; apply **asks** `assertChecksum` before mutation), [`docs/knowledge/services/granot-http-collector.md`](../../../docs/knowledge/services/granot-http-collector.md) (sealed plan is `computeChecksum` over `artifact_kind: "ingestion_plan"`), [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (preview / revision / destination / query / page stamps), [`docs/knowledge/services/domain-commands.md`](../../../docs/knowledge/services/domain-commands.md) (payload checksum is a **different** fold — `{command_name, resource_id, payload}`, `undefined` omitted). Distinct from already-recommended [durable-work-leases.md](durable-work-leases.md) (named-scope fence; never hashes). Distinct from later `actors.ts` / `checkpoints.ts` / `capability.ts` / `schema.ts` / `providerRetry.ts` / `runTransitions.ts` / `testing.ts`. Distinct from skipped `types.ts` `ChecksumEnvelope` / `ChecksumArtifactKind` (this file **stamps** the envelope; it does not name the kinds). Distinct from already-recommended [domain-commands-existing-write-context.md](domain-commands-existing-write-context.md) (`hashExistingWritePayload` / `stableJson` **omits** `undefined` and never **asks** this file). Distinct from already-recommended [domain-commands-entity-change.md](domain-commands-entity-change.md) (own `canonicalize` for field-diff equality). Distinct from already-recommended [observability-operational-reports.md](observability-operational-reports.md) (own `canonicalize` → `result_hash`). Distinct from already-recommended [reporting-reporting.md](reporting-reporting.md) `createOpaqueSampleEvidence` / `confirmationImmutableFingerprint` (**asks** `canonicalJson`, then HMAC with a secret — not SHA of the envelope). Distinct from already-recommended Granot Owner command modules (they **ask** `canonicalJson` then local `createHash` for `payload_checksum` — no envelope). Distinct from already-recommended [granot-lifecycle-capture.md](granot-lifecycle-capture.md) / [receipt evidence](granot-lifecycle) (`hashCredentialRedactedPayload` **asks** fold after redact). Distinct from later `providerRetry.ts` classifying `ChecksumMismatchError` by name as structural. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — do not invent “Durable Work” / “Artifact Checksum” copies. `docs/adr/` is absent here — do not invent ADR copies. Do not add a Durable Work Service in this rename.
- Callers: **four runtime families, plus fold-only walks that never stamp the envelope.** Already-recommended Best Relocation plan / apply: `applicationPlan.ts` stamps the plan; `worker.ts` restamps after missing-source rewrite; `applyPlan.ts` **asks** `assertChecksum` then stamps each action payload as the command `payload_checksum`; `repository.ts` stamps missing-source conflict keys; Wave B `ingestion.routes.ts` stamps attach-booking resolve. Already-recommended Granot HTTP `runWorkflow.ts` stamps / proves the sealed plan (`artifact_kind` still `"ingestion_plan"`). Already-recommended Reporting: `reporting.service.ts` `checksumArtifact` (draft / preview / revision), `destinationContract.ts` (snapshot + stable identity), `canonicalReporting.ts` / `pagination.ts` (query input / plan / page), `executionStream.ts` (data accumulator), `deliveryEngine.ts` (page recompute), live factories. Fold-only (no envelope): already-recommended `sourceChangePolicy.ts` (equal last-applied values), `identity.ts` (`JSON.parse(canonicalJson)`), reporting HMAC evidence / confirmation, Granot Owner commands / receipt evidence / discrepancies / connect-lead / referral / release. Barrel `durableWork/index.ts` re-exports this file. Tests: `durableWork.test.ts` proves key-order stability, uppercase prove, and two refusals (`undefined`, `Infinity`). Reporting / ingestion / Granot automation tests **ask** `computeChecksum` to mint expected hex. Not this **interface**: Domain Command `payload_checksum` from `existingWriteContext`, Observational `result_hash`, Entity Change field-diff, keyed HMAC samples.
- Seams callers need: fold-only (`canonicalJson`) vs envelope stamp / prove (`computeChecksum` / `assertChecksum`); `ChecksumEnvelope` (`checksum_version` + `artifact_kind` + `schema_version` + `payload`) vs a raw bag; stored hex (trim + lowercase, timing-safe) vs `ChecksumMismatchError`; refuse-to-fold (`CanonicalSerializationError` + path) vs mismatch. There is no begin / complete Domain Command **seam**. There is no Mongo **adapter**. There is no secret / HMAC **adapter**. There is no per-kind **adapter** beside the string `artifact_kind`.
- Split later (only if the file outgrows one sitting): this ~115-line file is one sitting if you read it as seal this immutable artifact. If it later splits: `foldThisBagIntoOneStableString.ts`, `stampThisSealedEnvelope.ts` — never `compute.ts` / `assert.ts` / `hash.ts` / `create.ts` / `update.ts` / `delete.ts`. Envelope kinds stay on skipped `types.ts`. Domain Command / Observational / Entity Change folds stay siblings / other services.

`canonicalJson` / `computeChecksum` / `assertChecksum` are executor mechanics. The owner question is: *Someone has a bag they intend to lock. Fold it so key order, Date vs ISO, and -0 cannot change the stamp. Refuse undefined, functions, symbols, bigint, non-finite numbers, invalid dates, circular references, and class instances. Then SHA-256 the sealed envelope — version 1, a named kind, a schema version, and the payload. Later, prove the same bag still hashes to the stored hex: trim, lowercase, compare in constant time. A mismatch throws. A bag that cannot be folded throws. This file does not pick which plan, revision, page, or destination to seal. This file does not persist the hex. This file does not hash a Domain Command payload through this envelope. Callers wrap their own payload or hash the fold themselves.*

Who approves a plan, who writes a revision, who HMAC-s a sample, and who hashes a command already live in other **modules**. Do not pull those in.

## What this file actually does

One “seal this immutable artifact” story with three owner operations, not “a checksum helper,” and not Approve This Best Relocation Plan / Save This Reporting Revision / Apply This Named Command Once:

1. **Fold this bag into one stable string** — `canonicalJson`. Null, string, boolean, and finite number stay JSON. `-0` becomes `0`. A Date becomes ISO-8601. Object keys sort. Arrays keep index order. Refuse `undefined`, `function`, `symbol`, `bigint`, non-finite number, invalid Date, circular reference, and any object whose prototype is not `Object.prototype` or `null`. Walk path (`$`, `$.key`, `$[0]`) is only for the refuse message. This beat does **not** hash. This beat does **not** require an envelope.

2. **Stamp this sealed envelope** — `computeChecksum`. SHA-256 (hex) of the fold of `{ checksum_version: 1, artifact_kind, schema_version, payload }`. Kind is whatever the caller put on skipped `types.ts` (`ingestion_plan`, `reporting_revision`, `reporting_destination_snapshot`, …). This beat does **not** persist. This beat does **not** compare.

3. **Prove this sealed envelope has not moved** — `assertChecksum`. Stamp again. Trim and lowercase the stored hex. Same-length timing-safe compare. Miss → `ChecksumMismatchError` (`code: "CHECKSUM_MISMATCH"`). Length miss is also a miss (do not call `timingSafeEqual` on unequal buffers). This beat does **not** fold a raw bag. This beat does **not** return a boolean.

There is no fourth mutate operation. `serialize` / `unsupported` are the shared fold. Re-export through the barrel is convenience for callers, not a second story.

## Organization

Keep one file. This is the screenplay for “seal this immutable artifact.” Envelope kinds already live on skipped `types.ts`. Named-scope fence already lives on already-recommended `leases.ts`. Who wraps a plan / revision / page already lives on already-recommended ingestion / Granot HTTP / reporting **modules**. Domain Command / Observational / Entity Change folds already live on already-recommended siblings. Do not pull those in. Do not invent a `DurableChecksumService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a per-kind **seam** that has only the `artifact_kind` string as an **adapter**. Do not invent an HMAC **seam** beside leftover reporting secrets. Do not invent a CRUD folder so “compute / assert each get a file.”

Do not move Domain Command `hashExistingWritePayload` here so “one hash owns the company.” Do not move reporting HMAC here so “one stamp owns samples.” Do not add `command_name` to `ChecksumEnvelope` so “Owner commands can share the envelope.” Do not split `compute.ts` / `assert.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `canonicalJson` | `foldThisBagIntoOneStableString` | Granot Owner commands, receipt evidence, BR source-change compare, reporting HMAC |
| `computeChecksum` | `stampThisSealedEnvelope` | BR / Granot plan, reporting artifacts, BR identity / missing-source keys |
| `assertChecksum` | `proveThisSealedEnvelopeHasNotMoved` | BR apply before mutation, Granot automation apply |
| `CanonicalSerializationError` | `thisBagCannotBeFolded` | fail-closed fold |
| `ChecksumMismatchError` | `thisSealedEnvelopeHasMoved` | fail-closed prove; later `providerRetry` matches the class name |
| `ChecksumEnvelope` | `ThisSealedEnvelope` | the handoff; keep the type on skipped `types.ts` |

Keep the old names as one-line aliases until already-recommended workers, reporting, and tests migrate. Do not make callers learn `createHash("sha256")` / `timingSafeEqual` / `Object.keys().sort()` as the domain language. Do **not** rename persisted hex columns (`plan_checksum`, `revision_snapshot_checksum`, `preview_checksum`, `destination_snapshot_checksum`) — those are the stored seal.

**No workflow class.** The one type that *does* earn a name already lives on skipped `types.ts`:

```ts
type ThisSealedEnvelope<T> = {
  checksum_version: 1
  artifact_kind: ChecksumArtifactKind
  schema_version: number
  payload: T
}
```

That is today’s `ChecksumEnvelope` — the handoff from “the caller named the kind” to “stamp or prove.” Do **not** add `secret` here so “HMAC can share the envelope.” Do **not** add `command_name` here so “Domain Commands can share the envelope.” Do **not** add `algorithm` here so “we might swap SHA.”

Leave `ChecksumArtifactKind` on skipped `types.ts`. Leave Domain Command `stableJson` on already-recommended `existingWriteContext.ts`. Leave reporting HMAC on already-recommended `reporting.service.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// checksum.ts
// Someone has a bag they intend to lock.
// Fold it so key order cannot change the stamp.
// Refuse anything that would make two machines disagree.
// Stamp the versioned envelope. Later prove the stored hex still matches.

// ── 1. Fold this bag into one stable string ───────────────

export function foldThisBagIntoOneStableString(value: unknown): string {
  return fold(value, "$", new Set())
}

function fold(value, path, walking): string {
  if (value === null) return "null"
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number") {
    refuseNonFinite(path, value)
    return JSON.stringify(Object.is(value, -0) ? 0 : value)
  }
  refuseUndefinedFunctionSymbolOrBigint(path, value)
  if (value instanceof Date) {
    refuseInvalidDate(path, value)
    return JSON.stringify(value.toISOString())
  }
  refuseACircle(path, value, walking)
  walking.add(value)
  try {
    if (Array.isArray(value)) return `[${value.map((entry, i) => fold(entry, `${path}[${i}]`, walking)).join(",")}]`
    refuseAClassInstance(path, value)
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${fold(value[key], `${path}.${key}`, walking)}`).join(",")}}`
  } finally {
    walking.delete(value)
  }
}

// ── 2. Stamp this sealed envelope ─────────────────────────

export function stampThisSealedEnvelope<T>(envelope: ThisSealedEnvelope<T>): string {
  return createHash("sha256").update(foldThisBagIntoOneStableString(envelope), "utf8").digest("hex")
}

// ── 3. Prove this sealed envelope has not moved ───────────

export function proveThisSealedEnvelopeHasNotMoved<T>(
  envelope: ThisSealedEnvelope<T>,
  storedHex: string,
): void {
  const actual = stampThisSealedEnvelope(envelope)
  const expected = storedHex.trim().toLowerCase()
  if (actual.length !== expected.length || !timingSafeEqual(Buffer.from(actual, "utf8"), Buffer.from(expected, "utf8"))) {
    throw new thisSealedEnvelopeHasMoved()
  }
}

export class thisBagCannotBeFolded extends TypeError {}
export class thisSealedEnvelopeHasMoved extends Error {
  readonly code = "CHECKSUM_MISMATCH"
}
```

Read the stamp-and-prove path out loud: *Refuse a bag that cannot be folded. Sort the keys. Write dates as ISO. Treat -0 as 0. Wrap the payload in version 1, a named kind, and a schema version. SHA-256 that string. Later fold the same envelope again, lowercase the stored hex, and compare in constant time. If the hex moved, throw. Never pick a plan. Never persist the hex. Never hash a Domain Command through this envelope.*

That is the operation. `createHash("sha256")` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Two stable folds disagree on `undefined`.** This file **refuses** `undefined`. Already-recommended `existingWriteContext.stableJson` **omits** `undefined` and never **asks** this file. Knowledge for Domain Commands still says “sorted keys, dates as ISO, `undefined` omitted.” Do not silently route command checksums through `foldThisBagIntoOneStableString` so “one fold owns the company” — that would change live `payload_checksum` values whenever a field is missing. Do not silently omit `undefined` here so “both folds match” — that would change every stored plan / revision hex that never had the key.

2. **Granot Owner commands hash the fold, not the envelope.** `bookingConfirmation.ts`, `bookingOwnerCommands.ts`, `connectBookingToLead.ts`, `referralBooking.ts`, `releaseOwnerCommands.ts`, and `discrepancyOwnerCommands.ts` do `createHash("sha256").update(canonicalJson({ command_name, … }))`. That is the Domain Command `payload_checksum` story, not `ThisSealedEnvelope`. Do not wrap those bags in `artifact_kind: "ingestion_plan"` so “one stamp owns approve and confirm.” Do not add a command kind this pass.

3. **Reporting revision prove does not **ask** `assertChecksum`.** Already-recommended `assertRevisionChecksum` stamps via local `checksumArtifact`, then `safeEqual`, then `reportingError("revision_checksum_mismatch", 409)`. BR apply and Granot automation **do** **ask** `assertChecksum` (`ChecksumMismatchError`). Do not silently swap the reporting prove so “one throw owns every mismatch” without an **interface** proof of the 409 shape. Do not delete `ChecksumMismatchError` so “reporting owns prove.”

4. **`artifact_kind: "ingestion_plan"` is a lying name outside Best Relocation.** Granot HTTP sealed plans, BR `sourceOwnedContentHash`, missing-source conflict keys, and Wave B attach-booking resolve all stamp that kind. The kind is on the envelope, so two different bags can share a hex space only by accident of payload. Do not invent new kinds this rename so “the string becomes true.” Do not start proving a Granot plan with a BR plan checksum.

5. **The sparse-array refuse is dead.** `Array.map` always yields `value.length` entries; holes become `undefined` and already throw `thisBagCannotBeFolded`. Do not add a second sparse walk so “the comment becomes true.” Leave the dead branch visible or delete it in the rename — do not change what a hole throws.

6. **Folder tests only cover the happy fold.** `durableWork.test.ts` proves key-order + Date stability, uppercase prove, `undefined`, and `Infinity`. It does not prove `-0`, invalid Date, circular reference, class instance / `Buffer`, `bigint`, function, symbol, trim/lowercase prove, length-mismatch prove, or `ChecksumMismatchError.code`. Add **interface** proofs; do not add a test per `unsupported` call.

7. **HMAC is not this stamp.** Already-recommended reporting sample evidence and confirmation fingerprints **ask** `canonicalJson` then HMAC with a secret. Do not route those through `stampThisSealedEnvelope` so “one checksum function owns samples.” Already-recommended reporting-reporting.md already forbids that move.

8. **Leave sibling modules alone.** Skipped `types.ts` owns the kind union. Later `providerRetry.ts` matches `ChecksumMismatchError` by name. Already-recommended workers own which bag to wrap. Do not open those as a second recommendation this pass.

## Testing

The **interface** is the test surface: `foldThisBagIntoOneStableString`, `stampThisSealedEnvelope`, `proveThisSealedEnvelopeHasNotMoved`.

Today’s folder test is not enough for the refuse list or the prove miss.

Add tests that name the operation:

**Fold**
- Same object with keys inserted in different order → same string. Nested Date → ISO, order-independent.
- `-0` and `0` → the same number token.
- `undefined` field, `Infinity`, `NaN`, invalid Date, circular reference, class instance, `bigint`, function, symbol → `thisBagCannotBeFolded` (path in the message).
- Array hole → refuse (today via `undefined`, not the dead sparse branch).

**Stamp**
- Envelope `{ checksum_version: 1, artifact_kind, schema_version, payload }` → 64 lowercase hex.
- Same payload, different `artifact_kind` or `schema_version` → different hex.
- This file does not persist the hex.

**Prove**
- Matching hex, uppercase or padded whitespace → no throw.
- Different hex, or different length → `thisSealedEnvelopeHasMoved` with `code: "CHECKSUM_MISMATCH"`.
- A bag that cannot be folded still throws `thisBagCannotBeFolded`, not mismatch.

**Out of scope for this interface**
- This file does not pick `ingestion_plan` / `reporting_revision` / destination kinds.
- This file does not hash `{command_name, resource_id, payload}`.
- This file does not HMAC a sample.
- This file does not approve a run or save a revision.

Do **not** add a test per helper (`fold`, `refuseACircle`, `refuseAClassInstance`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`canonicalJson` stays exported because fold-only callers are a real **adapter** seam (Owner command hash, HMAC, source-change equality), not a test leak.

## What I would not do

- A `DurableChecksumService` / `DurableWorkService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `createHash("sha256")`.
- Moving this into a CRUD folder (`compute.ts` / `assert.ts` / `hash.ts`) for cleanliness.
- Breaking the refuse-to-fold **seam**. `undefined` must keep throwing here even though Domain Command checksums omit it.
- Treating Domain Command `payload_checksum`, Observational `result_hash`, Entity Change field-diff, or reporting HMAC as this story.
- Inventing a per-kind **seam** that has only the `artifact_kind` string as an **adapter**.
- Silently routing `hashExistingWritePayload` through this fold so “one checksum owns approve and HTTP writes.”
- Jumping to `actors.ts` before this file is on the checklist.
- Writing a whole-folder recommendation for `durableWork`.
