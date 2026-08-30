# Keep This Raw RingCentral Telephony Delivery As An Audit Row — Strip Secrets From Headers, Preview Only The First Party So We Can Find The Session Later, Insert It, Acknowledge A Duplicate Uuid Without Inventing A Second Row, And If Mongo Is Missing Log A Redacted Copy Then Still Let Wave B Say 200 — Never Fold Parties, Never Evaluate, Never Persist A Session, Never Ingest, Never Create A Call Lead, Never Subscribe, Never Write A Local File — operational story

- Status: recommended
- Service: `ringcentral` (Wave A, in-progress)
- Pass: 5 of this service — `webhook-capture.ts`
- Remaining in this service: `webhook-subscriptions.ts`, `ringcentral-call-lead-ingest.service.ts`, `ringcentral-duplicate-guard.ts`, `callLeadConvergence.service.ts`, `shadow-call-leads-store.ts`, `processed-calls-store.ts`, `call-log-sync.service.ts`, `call-log-sync-state.store.ts`, `call-log-vetting.ts`, `analytics-reconcile.service.ts`, `auth.ts`
- Target: `src/services/ringcentral/webhook-capture.ts`
- Knowledge: [`docs/knowledge/services/ringcentral-call-lead-qualification.md`](../../../docs/knowledge/services/ringcentral-call-lead-qualification.md) (section 2 step 1: “Capture raw event (always, even when processing disabled)”; pipeline drawing starts at leftover normalize — this file is not a box; related-modules table does not name this path). Distinct from leftover payload fold: skipped `webhook-event-normalizer.ts` (maps **every** party; this file previews **parties[0]** only and **asks** leftover `valueToString` / `valueToNumber`). Distinct from leftover local file: skipped `local-webhook-capture.ts` (gitignored JSONL; **asks** this file’s header strip only). Distinct from leftover subscriptions: `webhook-subscriptions.ts` (owns the live telephony filter + `?direction=Inbound`; this file’s unused `RINGCENTRAL_TELEPHONY_SESSIONS_EVENT_FILTER` is a dead export). Distinct from already-recommended party persist: [recommendations/ringcentral-call-candidate-store.md](ringcentral-call-candidate-store.md) (folds one party; Wave B **asks** it only when processing is on). Distinct from already-recommended collapse: [recommendations/ringcentral-call-session-aggregator.md](ringcentral-call-session-aggregator.md). Distinct from already-recommended session persist: [recommendations/ringcentral-call-session-store.md](ringcentral-call-session-store.md). Distinct from leftover ingest: `ringcentral-call-lead-ingest.service.ts` (the only promotion gate). Distinct from leftover Call Log vet / leftover cron / leftover analytics / leftover seed. Distinct from leftover `ringcentral-mongo.ts` (`getRingCentralDb` — already-recommended session persist **asks** it; this file inlines `connectMongo` + `useDb` twice). Distinct from leftover `ringcentral-config.ts` (`webhookEvents` → `ringcentral_webhook_events` plus the `_test` suffix unless leftover config turns that suffix off — this file snapshots the name at **import** time into the lying `WEBHOOK_EVENTS_TEST_COLLECTION`). Distinct from skipped `call-candidate-types.ts` (`RingCentralWebhookEventDocument`). Distinct from Wave B `POST /api/webhooks/ringcentral` (this file always; leftover normalize / already-recommended party persist / already-recommended session persist / leftover ingest only when webhook processing is on **and** `MONGO_URI` is set). Distinct from Wave B `POST /api/webhooks/ringcentral-local` (leftover local file; **asks** header strip only). Distinct from already-recommended Granot keep: [recommendations/granot-lifecycle-capture.md](granot-lifecycle-capture.md) (five-header **allowlist** + credential-redacted hash; this file is a **denylist** and stores `rawBody` as-is). This checkout’s `CONTEXT.md` does not define Call Qualification / Call Lead Ingestion / Caller Match Key — the knowledge file links a parent glossary this tree does not ship. Do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: **Wave B webhook POST + Wave B debug list + leftover local-file header strip. No file test.** Wave B `ringcentral-webhook.routes.ts` — POST **asks** leftover `sanitizeHeaders` + leftover `previewRingCentralWebhookPayload` for the receive log, then **asks** `captureRingCentralWebhookEvent` **always** (even when `RINGCENTRAL_WEBHOOK_ENABLED` is off); debug `GET /api/dev/ringcentral/webhook-events` **asks** `listRingCentralWebhookEvents`. Wave B `ringcentral-webhook-local.routes.ts` — **asks** leftover `sanitizeHeaders` only, then leftover local-file append. Not this **interface**: leftover normalize, already-recommended party persist, already-recommended collapse, already-recommended session persist, leftover ingest, leftover subscriptions, leftover seed, leftover Call Log vet, Wave B `ingestSessionLead`.
- Seams callers need: keep-always vs Wave B process-only-when-enabled (Wave B still 200s after this file logs-only); first insert vs uuid-duplicate acknowledge (`storedRawEvent: true, duplicate: true` — Mongo already has the uuid; this delivery is not a second row); no-`MONGO_URI` / persist-failed both `{ storedRawEvent: false, duplicate: false }` (Wave B cannot tell them apart); header-strip **denylist** asked by Wave B POST, leftover local-file, and prepare; first-party preview vs leftover all-party fold; debug list hides `rawBody` + `headers` vs the stored row that keeps both
- Split later (only if the file outgrows one sitting): this ~290-line file is one sitting if you read it as keep this raw RingCentral telephony delivery as an audit row — strip secrets from headers, preview only the first party so we can find the session later, insert it, acknowledge a duplicate uuid without inventing a second row, and if Mongo is missing log a redacted copy then still let Wave B say 200; never fold parties, never evaluate, never persist a session, never ingest, never create a Call Lead, never subscribe, never write a local file. If it later splits: `keepThisRawRingCentralTelephonyDeliveryAsAnAuditRow.ts` / `previewTheFirstPartySoWeCanFindTheSessionLater.ts` / `showRecentRawDeliveriesWithoutTheRawBodyOrHeaders.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `capture.ts` / `store.ts`, and never merge leftover normalize, leftover subscriptions, leftover local-file, already-recommended party persist, already-recommended session persist, leftover ingest, leftover Call Log vet, or Wave B `ingestSessionLead` into this file

`captureRingCentralWebhookEvent` / `buildRingCentralWebhookCaptureDocument` / `previewRingCentralWebhookPayload` are executor mechanics. The owner question is: *RingCentral just delivered a telephony-sessions notification — or a Validation-Token handshake. Keep that raw delivery as an audit row. Strip authorization, cookie, and x-api-secret from the headers. Preview only the first party so later we can find the session, the party, and the subscription. Insert the row. If this uuid is already stored, say so and do not invent a second row. If Mongo is missing or the insert fails for any other reason, log a redacted copy and still let Wave B answer 200. Wave B may then leftover-normalize, leftover-persist parties, leftover-persist the session, and leftover-ingest — or it may do none of that because processing is off. This file never folds a party. Never evaluates. Never persists a session. Never ingests. Never creates a Call Lead. Never subscribes. Never writes a local JSONL file.*

Leftover normalize, leftover subscriptions, leftover local-file, already-recommended party persist, already-recommended collapse, already-recommended session persist, leftover ingest, leftover Call Log vet, leftover mongo helper, leftover config names, skipped types, and Wave B webhook HTTP already live in other **modules**. Do not pull those in.

## What this file actually does

Two operations of one “keep this raw RingCentral telephony delivery as an audit row — strip secrets from headers, preview only the first party so we can find the session later, insert it, acknowledge a duplicate uuid without inventing a second row, and if Mongo is missing log a redacted copy then still let Wave B say 200 — never fold parties, never evaluate, never persist a session, never ingest, never create a Call Lead, never subscribe, never write a local file” story, not “a webhook CRUD store,” and not leftover normalize / leftover ingest:

1. **Keep this raw delivery as an audit row** — `captureRingCentralWebhookEvent`. Build the row (`buildRingCentralWebhookCaptureDocument`): leftover header strip, leftover first-party preview, `rawBody` as-is, then copy uuid / subscription / event / timestamp / owner / telephony session / session / sequence onto the document only when present. No `MONGO_URI` → log leftover `redactSensitiveValues(document)` and return `{ storedRawEvent: false, duplicate: false }`. Insert. Success → `{ storedRawEvent: true, duplicate: false }`. Unique sparse `{ uuid: 1 }` 11000 → `{ storedRawEvent: true, duplicate: true }` (Mongo already has this uuid; this delivery is not a second row). Any other persist failure → log redacted and return `{ storedRawEvent: false, duplicate: false }`. This beat does **not** throw. This beat does **not** fold parties. This beat does **not** ingest.

2. **Show recent raw deliveries on the debug board** — `listRingCentralWebhookEvents(limit)`. Newest `receivedAt`. Projection drops `rawBody` and `headers`. The first-party preview (phones, names, session ids) still ships. This beat does **not** keep a delivery. This beat does **not** hide the preview.

There is no fold operation. There is no evaluate operation. There is no session persist. There is no ingest. There is no Call Lead write. There is no subscription write. There is no local-file write. Wave B leftover normalize is the all-party **adapter**. Leftover `ingestRingCentralQualifiedCall` is the only promotion gate. Leftover `appendLocalRingCentralWebhookEvent` is the local JSONL **adapter**. Leftover `buildRingCentralTelephonyEventFilters` is the subscription **adapter**.

`sanitizeHeaders` / `previewRingCentralWebhookPayload` sit on the keep path and are also asked by Wave B logging and leftover local-file. They are not extra owner operations. `RINGCENTRAL_TELEPHONY_SESSIONS_EVENT_FILTER` and `WEBHOOK_EVENTS_TEST_COLLECTION` are leftover names, not owner **seams**. Do not invent a dashboard for the debug list in this rename. Collection name comes from leftover config (`webhookEvents`) at **import** time, not a call-time ask.

## Organization

Keep one file as the screenplay for “keep this raw RingCentral telephony delivery as an audit row — strip secrets from headers, preview only the first party so we can find the session later, insert it, acknowledge a duplicate uuid without inventing a second row, and if Mongo is missing log a redacted copy then still let Wave B say 200; never fold parties, never evaluate, never persist a session, never ingest, never create a Call Lead, never subscribe, never write a local file.” Leftover normalize, leftover subscriptions, leftover local-file, already-recommended party persist, already-recommended collapse, already-recommended session persist, leftover ingest, leftover Call Log vet, leftover mongo helper, leftover config names, skipped types, and Wave B webhook HTTP already live in deeper **modules**. Do not pull those in. Do not invent a `WebhookCaptureService` class. Do not invent a begin / complete **seam** — this file’s write is one insert, not a command transaction. Do not invent a fold **adapter** beside leftover `normalizeRingCentralWebhookPayload`. Do not invent an ingest **adapter** beside leftover `ingestRingCentralQualifiedCall`. Do not invent a subscription **adapter** beside leftover `buildRingCentralTelephonyEventFilters`. Do not invent a local-file **adapter** beside leftover `appendLocalRingCentralWebhookEvent`.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `capture.ts` / `store.ts`. Those are persistence verbs, not the owner story. Do not move leftover all-party fold into this file so “capture already normalized the parties.” Do not move leftover subscriptions’ filter into this file so “one constant owns the telephony path.” Do not silently leftover-ingest after insert so “one write owns audit and promote.” Do not silently switch the header strip to Granot’s five-header allowlist so “both captures match.” Do not silently fail closed when the unique uuid index is missing so “Call Log’s index posture becomes this file’s.”

**External interface** stays small (this is the test surface). Keep, preview-first-party, strip-headers, and debug-list are one story’s raw-delivery audit, not four CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `captureRingCentralWebhookEvent` | `keepThisRawRingCentralTelephonyDeliveryAsAnAuditRow` | Wave B POST always, even when processing is off |
| `buildRingCentralWebhookCaptureDocument` | `prepareTheAuditRowFromThisDelivery` | keep **asks** this before the Mongo / log fork |
| `previewRingCentralWebhookPayload` | `previewTheFirstPartySoWeCanFindTheSessionLater` | Wave B receive log + prepare; leftover normalize still owns every party |
| `sanitizeHeaders` | `stripSecretsFromHeadersBeforeStoreOrLog` | Wave B POST, leftover local-file, and prepare |
| `listRingCentralWebhookEvents` | `showRecentRawDeliveriesWithoutTheRawBodyOrHeaders` | Wave B debug list |
| `CaptureRingCentralWebhookEventResult` | `WhetherWeKeptThisDeliveryOrAlreadyHadTheUuid` | `{ storedRawEvent, duplicate }` Wave B echoes |

Keep the old names as one-line aliases until Wave B webhook POST, leftover local-file, and any later file test migrate. Do not make callers learn `11000` / `insertOne` / `WEBHOOK_EVENTS_TEST_COLLECTION` as the domain language.

**Principle: old exports stay as aliases.** `captureRingCentralWebhookEvent` remains the imported name until Wave B persist migrates. `sanitizeHeaders` remains the imported name until leftover local-file migrates.

**No class for the workflow.** The type that *does* earn a name is the bag keep already returns, plus the first-party preview Wave B already logs:

```ts
type WhetherWeKeptThisDeliveryOrAlreadyHadTheUuid = {
  storedRawEvent: boolean  // Mongo has this uuid (insert or duplicate); false = logged-only
  duplicate: boolean       // 11000 on uuid; never true when storedRawEvent is false
}

type FirstPartyPreview = {
  subscriptionId: string | null
  telephonySessionId: string | null
  partyId: string | null
  // phones / names / status from parties[0] only
}
```

That is the handoff from “we kept (or logged) this raw delivery” to “Wave B may leftover-normalize and leftover-process, or it may stop because processing is off.” Do **not** add `parties[]` so “this file can replace leftover normalize,” do **not** add `ingestEligible` so “this file can replace leftover ingest,” and do **not** add `eventFilters` so “this file can replace leftover subscriptions.”

Do not add `normalizeRingCentralWebhookPayload` as a public story **seam** on this file — leftover normalize already owns that export. Do not add `processRingCentralCallSession` as a public **seam** — already-recommended session persist already owns that. Do not add `ingestRingCentralQualifiedCall` as a public **seam** — leftover ingest already owns that. Do not export `getWebhookEventsCollection` / `ensureWebhookEventIndexes` / `redactSensitiveValues` as public **seams** — they exist so the parent reads. Do not promote leftover `RINGCENTRAL_TELEPHONY_SESSIONS_EVENT_FILTER` or leftover `WEBHOOK_EVENTS_TEST_COLLECTION` to owner **seams** in this rename.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// webhook-capture.ts
// RingCentral just delivered a telephony-sessions notification.
// Keep that raw delivery as an audit row.
// Strip secrets from the headers.
// Preview only the first party so we can find the session later.
// If this uuid is already stored, say so — do not invent a second row.
// If Mongo is missing, log a redacted copy and still let Wave B say 200.
// Do not fold parties. Do not evaluate. Do not persist a session.
// Do not ingest. Do not create a Call Lead.

// ── 1. Keep this raw delivery as an audit row ─────────────

export async function keepThisRawRingCentralTelephonyDeliveryAsAnAuditRow(input)

function prepareTheAuditRowFromThisDelivery(input)     // today's buildRingCentralWebhookCaptureDocument
function stripSecretsFromHeadersBeforeStoreOrLog(headers)
function previewTheFirstPartySoWeCanFindTheSessionLater(payload)
function copyFindableIdsOnlyWhenPresent(document, preview)
function logARedactedCopyWhenMongoIsMissing(document)
async function insertTheAuditRow(document)
function acknowledgeThisUuidIsAlreadyStored(uuid)      // 11000 → stored true, duplicate true
function logARedactedCopyWhenPersistFailed(document, error)

// ── 2. Show recent raw deliveries on the debug board ──────

export async function showRecentRawDeliveriesWithoutTheRawBodyOrHeaders(limit)
```

Read the primary path out loud: *Strip authorization, cookie, and x-api-secret from the headers. Preview only the first party — subscription, telephony session, party, phones, status. Copy those findable ids onto the audit row only when they are present. Keep the raw body as-is. If Mongo is missing, log a redacted copy and tell Wave B we did not store. Insert. If this uuid is already there, tell Wave B we already had it. If the insert fails for any other reason, log a redacted copy and tell Wave B we did not store. Wave B still answers 200. Do not fold the other parties. Do not evaluate. Do not persist a session. Do not ingest. Do not create a Call Lead.*

That is the operation. `captureRingCentralWebhookEvent` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Wave B strips headers and previews the first party, then this file does both again.** POST logs leftover `sanitizeHeaders` + leftover `previewRingCentralWebhookPayload`, then keep rebuilds the same bags. Do not delete the route **ask** so “capture already logged.” Do not drop this file’s strip/preview so “the route already did it” — leftover local-file **asks** strip without keep. Keep both **seams**.

2. **This file previews `parties[0]`. Leftover normalize maps every party.** A later party lives only in `rawBody`. Knowledge’s pipeline drawing starts at leftover normalize. Do not silently walk every party so “capture already folded.” Do not move leftover normalize into this file so “one parse owns audit and qualify.”

3. **`storedRawEvent: true` on duplicate means “Mongo already has this uuid,” not “this insert succeeded.”** Wave B echoes it as `storedRawEvent` / `duplicateRawEvent`. Do not return `storedRawEvent: false` on 11000 so “we did not write this tick” without a paired Wave B test. Events with no uuid never 11000 — sparse unique lets them insert forever.

4. **No `MONGO_URI` and any other persist failure return the same `{ storedRawEvent: false, duplicate: false }`.** Wave B cannot tell “we logged because there is no database” from “the insert threw.” Do not add a third status so “the owner sees why” without a paired Wave B envelope test.

5. **Header strip is a denylist (`authorization`, `cookie`, `x-api-secret`).** `Validation-Token` stays on the stored row. Already-recommended Granot keep uses a five-header allowlist. Do not silently switch to that allowlist so “both captures match.” Do not add `validation-token` to the denylist so “the handshake secret never lands” without a paired leftover-local-file test.

6. **`WEBHOOK_EVENTS_TEST_COLLECTION` is a lying import-time snapshot.** Leftover config may unsuffix the name; already-recommended session persist **asks** leftover config at call time. If leftover collection mode flips after import, this file stays on the first name. Do not silently move the **ask** to call time so “the name cannot go stale” without a paired leftover-config test.

7. **`RINGCENTRAL_TELEPHONY_SESSIONS_EVENT_FILTER` has no callers.** Leftover subscriptions owns `TELEPHONY_SESSIONS_FILTER` plus `?direction=Inbound`. Do not silently delete the constant so “dead exports disappear” without checking leftover scripts that used to import it. Do not point leftover subscriptions at this file so “one filter owns subscribe and capture.”

8. **Runtime `createIndex` for uuid / session / receivedAt.** Leftover Call Log state fails closed when its unique key is missing and never creates it. This file creates its own. Do not silently stop creating so “indexes become a migration” without a paired first-insert test.

9. **This file inlines `connectMongo` + `useDb`. Already-recommended session persist **asks** leftover `getRingCentralDb`.** Do not silently switch helpers so “one mongo **adapter** owns RingCentral” in this rename.

10. **`redactSensitiveValues` runs only on the log-only paths.** Stored `rawBody` keeps phones, names, and leftover tokens that are not in the key denylist. Do not silently redact `rawBody` so “audit matches the log” without a paired debug-list test.

11. **Wave B’s catch returns `storedRawEvent: false` even when this file already inserted.** That lie is Wave B’s. Do not change keep’s return so “the envelope cannot lie” — Wave B is locked.

12. **Leave sibling modules alone.** Leftover normalize, leftover subscriptions, leftover local-file, already-recommended party persist, already-recommended collapse, already-recommended session persist, leftover ingest, leftover Call Log vet, leftover mongo helper, and leftover config names already live at the right **depth**. This file orchestrates leftover `valueToString` / `valueToNumber` only.

## Testing

The **interface** is the test surface: `keepThisRawRingCentralTelephonyDeliveryAsAnAuditRow`, `showRecentRawDeliveriesWithoutTheRawBodyOrHeaders`.

There is no file test today. Knowledge’s `call-candidate.test.ts` proves leftover normalize + already-recommended evaluate, not this file. Add tests that name the operation. Do not treat leftover normalize, leftover ingest, or Wave B POST as this file’s proof.

**Keep this raw delivery as an audit row**
- Delivery with a uuid → one row, `{ storedRawEvent: true, duplicate: false }`, first-party preview filled, `rawBody` kept.
- Same uuid again → still one row, `{ storedRawEvent: true, duplicate: true }`.
- No uuid → two inserts both succeed (sparse unique).
- Multi-party payload → preview is `parties[0]`; later parties exist only on `rawBody`.
- `authorization` / `cookie` / `x-api-secret` stripped; `validation-token` still stored (today).
- No `MONGO_URI` → `{ storedRawEvent: false, duplicate: false }`, redacted log, no throw.
- Non-11000 persist failure → same bag, redacted log, no throw.
- This beat never **asks** leftover normalize. This beat never returns a Call Lead id. This beat never **asks** leftover ingest.

**Show recent raw deliveries**
- Newest `receivedAt` first.
- Projection omits `rawBody` and `headers`. First-party preview (phones, session ids) still present.

Do **not** add a test per helper (`copyFindableIdsOnlyWhenPresent`, `acknowledgeThisUuidIsAlreadyStored`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** add leftover normalize, leftover subscriptions, leftover local-file, leftover ingest, already-recommended party persist, already-recommended session persist, leftover Call Log vet, or Wave B `ingestSessionLead` as this file’s proof. Wave B POST tests stay on Wave B — they **ask** this interface; they do not own the audit row.

## What I would not do

- A `WebhookCaptureService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`capture.ts` / `insert.ts` / `list.ts`) “for cleanliness.”
- Breaking Wave B’s keep-always-then-maybe-process **seam**, leftover local-file’s header-strip **seam**, or leftover normalize’s all-party **seam**.
- Treating leftover `normalizeRingCentralWebhookPayload`, leftover `appendLocalRingCentralWebhookEvent`, leftover `buildRingCentralTelephonyEventFilters`, leftover `ingestRingCentralQualifiedCall`, or leftover `vetRingCentralCallLogRecord` as this story. Those are different **adapters**.
- Inventing a fold **seam** that has only one **adapter** (this file never walks every party).
- Silently merging leftover normalize into this file, silently switching the header denylist to Granot’s allowlist, silently failing closed without the uuid index, or silently leftover-ingesting after insert, while recommending a rename.
- Jumping to leftover subscriptions while this service still has unchecked Wave A modules.
- Writing a whole-folder recommendation for `ringcentral`.
