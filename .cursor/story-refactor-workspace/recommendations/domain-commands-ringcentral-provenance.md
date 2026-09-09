# Prove This Telephony Is Server-Verified — Refuse A Blank Session First, Then Allow Call Log When The Connection Key Names That Same Session As Call-Log Sync Without Opening The Session Store, Or Allow Webhook Only When The Connection Key Names That Same Session As Webhook And The Persisted Session Exists With A Matching Telephony Id — Never Trust A Client Boolean, Never Prove Qualification, Never Adopt, Never Connect Command Mongo On The Call-Log Path — operational story

- Status: recommended
- Service: `domainCommands` (Wave A, in-progress)
- Pass: 3 of this service — `ringcentralProvenance.ts`
- Remaining in this service: `entityChange.ts`, `existingWriteContext.ts`, `existingWrites.ts`, `bookings.ts`
- Target: `src/services/domainCommands/ringcentralProvenance.ts`
- Knowledge: [`docs/knowledge/services/domain-commands.md`](../../../docs/knowledge/services/domain-commands.md) section **Command origins** names `verifyTrustedRingCentralTelephonyProvenance` — never a client boolean. `applies_to` lists `commandContext.ts` and does **not** list this file. Distinct from who may speak: already-recommended [domain-commands-command-context.md](domain-commands-command-context.md) — that file **asks** this **interface** (default `verifyRingCentralTelephony`) after the fixed `ringcentral-call-ingest` actor pair, then throws `INVALID_DOMAIN_COMMAND_CONTEXT` when this returns false. Distinct from apply-once / replay / after-commit finalize: already-recommended [domain-commands-idempotency.md](domain-commands-idempotency.md) — that file **asks** the speaker-gate before its own `connect`; this file is not on that barrel. Distinct from leftover adopt / leftover convergence-conflict bag: leftover `ringcentral/callLeadConvergence.service.ts` `buildRingCentralCommandContext` **builds** `source_receipt_id` = leftover `stableCallIdentity` (`telephonySessionId ?? callLogId`) and `source_connection_key` = `ringcentral:${ingestionSource}:${identity}` (`webhook` | `call_log_sync`). Distinct from already-recommended session persist: [ringcentral-call-session-store.md](ringcentral-call-session-store.md) — this file **asks** `findRingCentralCallSession` only on the webhook key; Call Log never **asks** that file. Distinct from leftover Call Lead ingest / leftover Call Log cron / leftover processed-calls / leftover duplicate guard / leftover analytics. Distinct from leftover `assertVerifiedRoute` inside leftover adopt’s transaction (active route, call start, scope, bounded identity — not this file). Distinct from leftover `ringcentral-mongo.ts` (`getRingCentralDb` → `connectMongo` + `useDb`) — already-recommended find **asks** that; this file never imports it. Distinct from HTTP → trusted admin bag: later `existingWriteContext.ts` (RingCentral is never that origin). Distinct from append-only Entity Change: later `entityChange.ts`. Distinct from actor factories: `durableWork/actors.ts` (Wave A, still unvisited — do not open). Distinct from the thin registry object: `index.ts` (skipped on open; this file is **not** re-exported). Checked-in Granot Lead-write / Booking / Release / Referral effect flags stay false — do not describe those Owner paths as live. This checkout’s `CONTEXT.md` is a pointer to a parent glossary that is not in this tree — do not invent “Telephony Session” / “Command Origin” copies. `docs/adr/` is absent here — do not invent ADR-0001 copies. Do not add this path to knowledge in this rename.
- Callers: **one runtime import.** Already-recommended `commandContext.ts` `defaultVerifier.verifyRingCentralTelephony` **asks** `verifyTrustedRingCentralTelephonyProvenance`. Barrel `domainCommands/index.ts` does **not** re-export this file. Leftover `buildRingCentralCommandContext` **builds** the two strings; leftover adopt / leftover convergence-conflict enter the executor and never import this file. Tests: `domainCommands.test.ts` AC-21 **injects** `{ verifyRingCentralTelephony: async () => false }` (and one retry case injects `true`) — they never **ask** this export. Test helper `ringcentralContext` uses `source_connection_key: "ringcentral"`, which the live verifier would refuse. There is no `ringcentralProvenance.test.ts`. Already-recommended session-store rec names this file as leftover provenance. Not this **interface**: `assertCommandContext`, `findRingCentralCallSession`, `buildRingCentralCommandContext`, `adoptRingCentralCall`, `assertVerifiedRoute`.
- Seams callers need: boolean proof **here** vs speaker-gate throw **next door**; Call Log format-only (no session store) vs webhook live-session lookup; this proof **before** leftover adopt’s in-transaction route/start/scope/identity revalidation; injected test verifier vs this default **adapter**. There is no HTTP **adapter**. There is no processed-calls **adapter**. There is no qualification **adapter**. There is no ingest **adapter**.
- Split later (only if the file outgrows one sitting): keep one file — this is already one sitting (~32 lines). If it later splits: `proveThisTelephonyIsServerVerified.ts` — never `create.ts` / `update.ts` / `delete.ts` / `verify.ts` / one file per ingestion source. Speaker-gate, leftover adopt, already-recommended session persist, and leftover Call Log cron stay siblings / other services.

`verifyTrustedRingCentralTelephonyProvenance` is executor mechanics. The owner question is: *Someone already named a RingCentral command and already put two strings on the bag: a receipt that is supposed to be the call’s stable identity, and a connection key that is supposed to name how the server first saw that call. Before the speaker-gate allows RingCentral to speak, prove those strings on the server. A blank receipt is not telephony. Call Log is already qualified on the shared ingest seam — if the connection key is exactly `ringcentral:call_log_sync:` plus that same receipt, believe it and do not open the session store; leftover adopt will revalidate route, start, scope, and identity inside its own transaction. Webhook is only a live session: the connection key must be exactly `ringcentral:webhook:` plus that same receipt, already-recommended find must return a session, and that session’s telephony id must match the receipt. A client boolean is never an input. This file does not say the call was qualified. This file does not adopt. This file does not create a Call Lead. Call Log does not connect. Webhook may open already-recommended find, which opens leftover RingCentral Mongo.*

Who may speak, who applies the named command, who persists the session, and who adopts already live in other **modules**. Do not pull those in.

## What this file actually does

Two operations of one “prove this telephony is server-verified” story, not “a provenance helper,” and not leftover adopt / already-recommended speaker-gate / leftover Call Lead ingest:

1. **Refuse a blank telephony identity** — trim `source_receipt_id`. Empty or missing → `false`. Do not read the connection key. Do not **ask** already-recommended find. The speaker-gate turns this `false` into “RingCentral commands require server-verified telephony provenance.”

2. **Prove the named path** — trim `source_connection_key`. **Call Log:** key equals `ringcentral:call_log_sync:${receipt}` → `true` without a store. File comment: qualification already ran on leftover ingest; leftover adopt revalidates inside its transaction. **Webhook:** key equals `ringcentral:webhook:${receipt}` **and** already-recommended `findRingCentralCallSession(receipt)` returns a document whose `telephonySessionId` equals that receipt → `true`. Anything else — wrong prefix, receipt/key mismatch, missing session, null connection — is `false`. This beat does **not** read `ingestEligible`, leftover evaluate status, leftover processed-calls, or leftover Call Log cursor.

There is no third mutate operation. There is no actor check (already-recommended speaker-gate owns the fixed ingest pair). There is no `ingestionSource` enum here — the two legal leftover sources are spelled into the key by leftover `buildRingCentralCommandContext`. `RingCentralTelephonyProvenanceInput` is the already-built ask.

## Organization

Keep one file. This is the screenplay for “prove this telephony is server-verified.” Who may speak already lives on already-recommended `commandContext.ts`. Apply-once already lives on already-recommended `idempotency.ts`. Session persist already lives on already-recommended `call-session-store.ts`. Leftover adopt / leftover bag already live on leftover `callLeadConvergence.service.ts`. Leftover ingest / leftover Call Log cron already live on `ringcentral/`. Actor factories already live on `durableWork/actors.ts`. Do not pull those in. Do not invent a `RingCentralProvenanceService` class. Do not invent an HTTP **seam**. Do not invent a processed-calls **seam**. Do not invent a qualification **seam**. Do not invent a third path so “analytics reconcile can speak.”

Do not move this proof into `commandContext.ts` so “the speaker check includes the session store.” Do not move `findRingCentralCallSession` here so “one file owns webhook sessions.” Do not move leftover `assertVerifiedRoute` here so “proof includes the active route.” Do not add this file to `index.ts` so “routes can prove.” Do not split `create.ts` / `update.ts` / `delete.ts` or `webhook.ts` / `callLog.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `verifyTrustedRingCentralTelephonyProvenance` | `proveThisTelephonyIsServerVerified` | speaker-gate **asks** before leftover adopt; Call Log format vs webhook live session; boolean, not a throw |
| `RingCentralTelephonyProvenanceInput` | `WhoBroughtThisTelephony` | the two strings leftover adopt already stamped; never a client boolean |

Keep the old names as one-line aliases until `commandContext.ts` migrates. Do not make callers learn `verify` / `findOne` as the domain language.

**No class for the workflow.** The one type that *does* earn a name is the already-built ask:

```ts
type WhoBroughtThisTelephony = {
  source_receipt_id: string | null      // leftover stableCallIdentity
  source_connection_key: string | null  // ringcentral:${webhook|call_log_sync}:${identity}
}
```

That is the handoff from “leftover adopt named this call” to “the speaker-gate may let RingCentral speak.” Do **not** add `forged: boolean` so “the client can attest.” Do **not** add `ingestEligible` so “proof matches leftover ingest.” Do **not** add `callLogId` as a second receipt so “Call Log can skip the embedded key.”

Leave speaker-gate on `commandContext.ts`. Leave leftover adopt on `callLeadConvergence.service.ts`. Leave already-recommended find on `call-session-store.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// ringcentralProvenance.ts
// Someone already named a RingCentral command
// and stamped a receipt plus a connection key.
// Prove those strings on the server.
// A blank receipt is not telephony.
// Call Log is a key that names this same session as call-log sync —
// do not open the session store.
// Webhook is only a live session whose telephony id matches.
// A client boolean is never an input.
// This file does not adopt. This file does not qualify.

// ── 1. Refuse a blank telephony identity ──────────────────

export async function proveThisTelephonyIsServerVerified(who: WhoBroughtThisTelephony)
  const receipt = who.source_receipt_id?.trim()
  if (!receipt) return false
  return thisCallLogKeyNamesThatSession(who, receipt)
      || await thisWebhookSessionIsLiveOnTheServer(who, receipt)

// ── 2. Prove the named path ───────────────────────────────

function thisCallLogKeyNamesThatSession(who, receipt)
  // exact `ringcentral:call_log_sync:${receipt}`
  // true without findRingCentralCallSession

async function thisWebhookSessionIsLiveOnTheServer(who, receipt)
  if (who.source_connection_key?.trim() !== `ringcentral:webhook:${receipt}`)
    return false
  const session = await findRingCentralCallSession(receipt) // already-recommended
  return session != null && session.telephonySessionId === receipt
```

Read the proof out loud: *trim the receipt; if it is blank, this is not telephony. If the connection key is exactly call-log sync plus that same receipt, believe the shared ingest seam and stop — leftover adopt will revalidate inside its write. If the connection key is exactly webhook plus that same receipt, open the already-recommended session store and believe only a live session whose telephony id matches. Anything else, including a client boolean or a key that says only “ringcentral,” is not proof.*

That is the operation. `verifyTrustedRingCentralTelephonyProvenance` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The file is named ringcentralProvenance.** It does not store provenance. It proves two strings. Leftover `buildRingCentralCommandContext` is what *stamps* the bag. The file name should say the story (`proveThisTelephonyIsServerVerified` / keep the path and alias the old file name until `commandContext.ts` moves).

2. **Call Log is a format match; webhook opens a store.** Knowledge says “never a client boolean” and does not say “both paths hit a store.” Do not start **asking** leftover processed-calls or leftover Call Log cursor on the Call Log path so “both paths look up.” Do not delete the Call Log short-circuit so “one find owns every RingCentral command.”

3. **Webhook proof does not read `ingestEligible`.** A persisted rejected or pending session still proves. Leftover ingest only promotes when already-recommended collapse stamped leftover ingest. Do not require qualified + terminal here so “proof matches leftover ingest,” and do not start leftover-ingesting from this file.

4. **`source_receipt_id` is leftover `stableCallIdentity`, not always a telephony session id.** Leftover identity is `telephonySessionId ?? callLogId`. Call Log can prove `ringcentral:call_log_sync:${callLogId}` when telephony is missing. Webhook treat-as-telephony-id would then **ask** find by a Call Log id and fail closed. Do not silently require `telephonySessionId` here so “receipt is always a session,” and do not add a `callLogId` branch so “this file replaces leftover identity.”

5. **The equality after find-by-id is nearly tautological.** Already-recommended find queries `{ provider: "ringcentral", telephonySessionId }`. The extra `session.telephonySessionId === receipt` only bites a stubbed find. Do not drop it so “we trust the query,” and do not add a provider check so “one find owns the provider.”

6. **Webhook proof may connect before the executor’s `connect`.** Already-recommended find **asks** leftover `getRingCentralDb` → `connectMongo()`. Call Log does not. Prior speaker-gate rec says that file never connects — true of that file; this default **adapter** can. Do not move this proof after executor `connect` so “one connect owns the proof,” and do not teach this file to call `connectMongo` itself.

7. **Knowledge `applies_to` omits this file.** Command origins names the function. Do not add the path to `docs/knowledge` in this rename. Parked in `CONTRADICTIONS.md`.

8. **Leave sibling modules alone.** `assertCommandContext`, `findRingCentralCallSession`, `buildRingCentralCommandContext`, leftover `assertVerifiedRoute`, leftover `ingestRingCentralQualifiedCall` are already the right **depth**. This file **asks** the second; it does not own them.

## Testing

The **interface** is the test surface: `proveThisTelephonyIsServerVerified`.

Today’s `domainCommands.test.ts` never **asks** this export. AC-21 injects a boolean on the speaker-gate. That is the speaker-gate **adapter**, not this proof. A later implementer must prove this file with a stubbed already-recommended find (or an in-memory session document), not a live RingCentral network.

**Blank identity**
- `source_receipt_id` null / `""` / whitespace-only → `false`. Already-recommended find is **not** asked. Connection key is ignored.

**Call Log**
- Key `ringcentral:call_log_sync:${receipt}` → `true` without find.
- Key `ringcentral:call_log_sync:${otherId}` (receipt/key mismatch) → `false`.
- Key `ringcentral:call_log_sync:${receipt}` plus a missing session still → `true` (store is not the Call Log **seam**).

**Webhook**
- Key `ringcentral:webhook:${receipt}` + find returns `{ telephonySessionId: receipt }` → `true`.
- Same key + find returns `null` → `false`.
- Same key + find returns a document whose telephony id differs → `false`.
- Session exists but key is `ringcentral` / `ringcentral:webhook:${otherId}` / null → `false`.

**Do not add**
- A test per helper (`thisCallLogKeyNamesThatSession`).
- A test that leftover adopt called leftover `assertVerifiedRoute` — that is leftover adopt’s **interface**.
- A test that find used leftover `getRingCentralDb` — that is already-recommended session persist.
- A helper-unit test that has to change when `thisWebhookSessionIsLiveOnTheServer` is inlined.
- A live RingCentral network test.
- Changing test helper `ringcentralContext`’s `"ringcentral"` key so “the fixture is a real key” inside the speaker-gate suite.

`RingCentralTelephonyProvenanceInput` stays exported because leftover adopt and the speaker-gate already share that bag shape — not a test leak.

## What I would not do

- A `RingCentralProvenanceService` / `TelephonyService` class with `create` / `update` / `delete` / `verify`.
- Thirty two-line functions that only wrap `trim`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or `webhook.ts` / `callLog.ts` “for cleanliness.”
- Breaking the Call Log format-only **seam** or the webhook live-session **seam**.
- Treating leftover adopt, leftover Call Lead ingest, already-recommended speaker-gate, or already-recommended session persist as this story. Those **build** the bag, **ask** this boolean, or **own** the store.
- Inventing a processed-calls **seam** or a qualification **seam** that has only one **adapter** inside this file.
- Silently requiring `ingestEligible`, silently looking up Call Log rows, silently exporting this file from the barrel, or silently adding a client boolean field.
- Writing a whole-folder recommendation for `domainCommands`.
- Jumping to `durableWork` while this checklist still has unchecked modules.
