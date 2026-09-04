# Ask RingCentral If This Account Can See This Number — Load The Account Phone Book Once When Many Numbers Will Be Asked — Fold And Match Against That Book — Return Valid With Provider Ids, Invalid When The Number Is Missing Or Will Not Fold, Or Unavailable When The Ask Failed — Never Stamp The Card — Never Turn The Number On — Never Decide Which Incoming Call Becomes A Call Lead — operational story

- Status: recommended
- Service: `operationsRegistry` (Wave A, in-progress)
- Pass: 8 of this service — `ringCentralValidation.ts`
- Remaining in this service: `granotCrmSources.ts`, `crmSourceOutboundSms.ts`, `granotCrmSourceProjections.ts`, `granotAutomationSources.ts`, `trustedActor.ts`, `registryAudit.ts`, `runtimeTelemetry.ts`, `queries/overview.ts`, `queries/health.ts`, `queries/changes.ts`
- Target: `src/services/operationsRegistry/ringCentralValidation.ts`
- Knowledge: [`docs/knowledge/services/operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) (lumps leftover `ringCentralRegistry.ts` / this file as “inbound-route snapshot used at Call Qualification time” — that sentence names leftover `ringCentralSnapshot.ts`, not leftover Owner write and not this account-inventory ask). Owner UI spec already names this export: [`docs/operations-registry-source-connections-owner-ui-specification.md`](../../../docs/operations-registry-source-connections-owner-ui-specification.md) §3.6.1 (activation checklist step 2 **asks** leftover `validateRingCentralNumberAgainstAccount` and refuses leftover `invalid` / leftover `unavailable`). Software rule: [`.cursor/rules/operations-registry.mdc`](../../../.cursor/rules/operations-registry.mdc) (M5 apply must still match the reviewed dry-run manifest before any RingCentral validation begins). Already-recommended leftover Owner write: [recommendations/operations-registry-ring-central-registry.md](operations-registry-ring-central-registry.md) (**asks** leftover `validateRingCentralNumberAgainstAccount` as the default leftover `RingCentralRouteValidator`; leftover `/validate` stamps the card and writes the leftover Operational Event — this file does neither). Already-recommended leftover inbound-number book: [recommendations/operations-registry-ring-central-snapshot.md](operations-registry-ring-central-snapshot.md) (loader is leftover `ever_activated` + leftover `valid`; it does **not** import this file). Already-recommended leftover token mint: [recommendations/ringcentral-auth.md](ringcentral-auth.md) (skipped leftover `client.ts` **asks** leftover `getValidToken`; this file **asks** leftover `ringCentralRequest`, not leftover auth). Leftover phone fold: leftover `ringcentral/phone-normalization.ts`. Leftover `queries/health.ts` reads leftover `validation_status === "invalid"` on the models — it does **not** import this file. Leftover M5 `scripts/migrations/operations-registry-ringcentral.ts` **asks** leftover `createRingCentralAccountRouteValidator` for preflight, then injects that result into leftover `validateRingCentralRoute`. This checkout’s `CONTEXT.md` does not define inbound number / inbound route — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: already-recommended leftover Owner write leftover `validateRingCentralRoute` (**asks** leftover `validateRingCentralNumberAgainstAccount` unless a leftover `RingCentralRouteValidator` is injected). Leftover M5 apply (**asks** leftover `createRingCentralAccountRouteValidator`, then leftover `validateRingCentralRoute` with a one-shot leftover result). Barrel: `operationsRegistry/index.ts`. Wave B leftover `POST .../inbound-routes/:id/validate` does **not** import this file — it **asks** leftover Owner write. Tests: `ringCentralValidation.test.ts` (leftover shared inventory load; leftover valid + leftover not-found in parallel). Already-recommended leftover snapshot / leftover Call Qualification / leftover Call Log / leftover webhook **do not import this file**.
- Seams callers need: leftover live per-ask (Owner HTTP default) vs leftover shared-load factory (M5 preflight) vs leftover injected leftover `RingCentralRouteValidator` (M5 stamps the card without a second HTTP); leftover injectable leftover `AccessiblePhoneNumberLoader` (file-test **adapter**); leftover `valid` / leftover `invalid` / leftover `unavailable` result (leftover Owner write maps leftover `unavailable` → stored leftover `unvalidated`)
- Split later (only if the file outgrows one sitting): this ~164-line file is one sitting if you read it as ask RingCentral if this account can see this number — load the account phone book once when many numbers will be asked — fold and match against that book — return valid with provider ids, invalid when the number is missing or will not fold, or unavailable when the ask failed — never stamp the card — never turn the number on — never decide which incoming call becomes a Call Lead. If it later splits: `askRingCentralIfThisAccountCanSeeThisNumber.ts` / `loadTheAccountPhoneBookOnceThenAskAboutManyNumbers.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `validate.ts`, and never merge leftover Owner inbound-number stamp, leftover inbound-number book, leftover Call Qualification, leftover token mint, leftover phone fold, leftover health findings, leftover M5 apply orchestration, or Wave B leftover `/validate` HTTP into this file

`validateRingCentralNumberAgainstAccount` / `createRingCentralAccountRouteValidator` are executor mechanics. The owner question is: *Before the Owner may turn a RingCentral inbound number on, this account must be able to see that number. Ask RingCentral for the phone book this process can read. Fold the presented number. If it will not fold, say invalid. If the book does not hold that folded number, say invalid not-found. If the ask itself failed — credentials, rate limit, or any other throw — say unavailable, do not pretend the number is missing. If it matches, return valid with the provider ids and the observed target name. When M5 will ask about many numbers, load that book once and reuse it. This file does not stamp the card. It does not write a Registry Change. It does not turn the number on. It does not decide which incoming call becomes a Call Lead.*

Leftover Owner inbound-number stamp, leftover inbound-number book, leftover Call Qualification, leftover token mint, leftover HTTP client, leftover phone fold, leftover health findings, leftover M5 apply orchestration, and Wave B leftover `/validate` HTTP already live in other **modules**. Do not pull those in.

## What this file actually does

Two operations of one “ask RingCentral if this account can see this number — load the account phone book once when many numbers will be asked — fold and match against that book — return valid with provider ids, invalid when the number is missing or will not fold, or unavailable when the ask failed — never stamp the card — never turn the number on — never decide which incoming call becomes a Call Lead” story, not “a RingCentral route validation CRUD helper,” and not leftover Owner write / leftover snapshot:

1. **Ask RingCentral if this account can see this number** — leftover `validateRingCentralNumberAgainstAccount` / leftover `validateWithPhoneNumberLoader`. Parameter is leftover `normalizedPhoneNumber`. First leftover fold of that string fails → leftover `invalid` / leftover `RINGCENTRAL_NUMBER_INVALID` (`The phone number could not be normalized.`) — leftover loader is **not** called. Else leftover-load the book. Walk records; leftover-fold leftover `record.phoneNumber`; first leftover fold that equals the incoming string is the match. Miss → leftover `invalid` / leftover `RINGCENTRAL_NUMBER_NOT_FOUND`. Hit → leftover `valid` / leftover `RINGCENTRAL_NUMBER_ACCESSIBLE`, leftover `phoneNumberId` (leftover `id`), leftover `extensionId` (leftover `extension.id`), leftover `queueName` (leftover `extension.name` else leftover `label` else leftover `features`), leftover `observedTargetNames` (`[queueName]` or `[]`). Leftover `queueId` is leftover `extension.id` only when leftover `usageType === "CompanyNumber"` or leftover `type === "TollFree"`; otherwise omit it. Any leftover loader throw → leftover `unavailable` / leftover `RINGCENTRAL_VALIDATION_UNAVAILABLE` with leftover `safeValidationFailureMessage` (leftover `RingCentralApiError` 401/403 → credentials; leftover 429 → rate limited; other leftover HTTP → `HTTP ${status}`; anything else → temporarily unavailable). This beat does **not** throw to leftover Owner write. This beat does **not** stamp leftover `validation_status`. This beat does **not** write leftover `ringcentral.route.validation_failed`. This beat does **not** turn the number on.

2. **Load this account’s phone book once when many numbers will be asked** — leftover `createRingCentralAccountRouteValidator` / leftover `loadAccessiblePhoneNumbers`. Factory default leftover-loads leftover `GET /restapi/v1.0/account/~/phone-number?page=&perPage=100` through leftover `ringCentralRequest`. Pages while leftover `page <= 20` and the page still returned leftover `perPage` records. Missing leftover `records` is an empty page and stops. Leftover M5 **asks** the factory, leftover `Promise.all`s every leftover mapping, and refuses leftover apply when any leftover preflight is not leftover `valid`. Leftover Owner HTTP does **not** **ask** the factory — it leftover-asks leftover `validateRingCentralNumberAgainstAccount`, one leftover live book per leftover `/validate`. Leftover tests leftover-inject leftover `AccessiblePhoneNumberLoader`. This beat does **not** persist the book. This beat does **not** forget leftover `RINGCENTRAL_ROUTE_CACHE_KEY`. This beat does **not** resolve a call.

There is no third leftover stamp operation. There is no leftover activate operation. There is no leftover snapshot-build operation. Leftover `ringCentralRequest` is the HTTP **adapter**. Leftover `normalizePhoneNumberToE164Like` is the phone-fold **adapter**. Leftover `RingCentralRouteValidator` is the ask **seam**. Leftover `AccessiblePhoneNumberLoader` is the book-load **adapter**. Wave B leftover `/validate` leftover-asks leftover Owner write, which leftover-asks this file — that is a second leftover HTTP **adapter**, not a second owner story. Leftover M5 leftover-injects a leftover validator that returns the leftover preflight result; it is not a second leftover ask.

`asRecord` / leftover `isRecord` / leftover `valueToString` / leftover `safeValidationFailureMessage` sit on the ask and load paths. They are not extra owner operations. Do not export leftover `validateWithPhoneNumberLoader` / leftover `loadAccessiblePhoneNumbers` / leftover `AccessiblePhoneNumberLoader` as a public **seam**. Do not invent a dashboard for leftover `observedTargetNames` in this rename — leftover Owner write copies that array onto the card.

## Organization

Keep one file as the screenplay for “ask RingCentral if this account can see this number, load the account phone book once when many numbers will be asked, fold and match against that book, return valid with provider ids, invalid when the number is missing or will not fold, or unavailable when the ask failed, never stamp the card, never turn the number on, never decide which incoming call becomes a Call Lead.” Leftover Owner inbound-number stamp, leftover inbound-number book, leftover Call Qualification, leftover token mint, leftover HTTP client, leftover phone fold, leftover health findings, leftover M5 apply orchestration, and Wave B leftover `/validate` HTTP already live in deeper **modules**. Do not pull those in. Do not invent a `RingCentralValidationService` class. Do not invent a begin / complete **seam** — this file has no transaction. Do not invent a second leftover ask **adapter** beside leftover `RingCentralRouteValidator`. Do not invent a second leftover HTTP **adapter** beside leftover `ringCentralRequest`.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `validate.ts` as a CRUD folder. Those are persistence verbs, and this file does not persist cards. Do not move leftover `validateRingCentralRoute` into this file so “one file owns validate.” Do not move leftover `loadAccessiblePhoneNumbers` into leftover snapshot so “the book owns valid.” Do not silently start leftover-stamping leftover `validation_status` here so “the ask lands the card.”

**External interface** stays small (this is the test surface). Ask-one and share-the-book are one story’s account-inventory ask, not two CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `validateRingCentralNumberAgainstAccount` | `askRingCentralIfThisAccountCanSeeThisNumber` | leftover Owner write leftover `/validate` default; leftover Owner UI spec step 2 |
| `createRingCentralAccountRouteValidator` | `loadTheAccountPhoneBookOnceThenAskAboutManyNumbers` | leftover M5 preflight; leftover tests leftover-inject the book |
| `RingCentralRouteValidator` | `AskWhetherThisAccountCanSeeThisNumber` | leftover live per-ask vs leftover shared-load vs leftover M5 inject |
| `RingCentralRouteValidationResult` | `WhetherThisAccountCanSeeThisNumber` | leftover `valid` / leftover `invalid` / leftover `unavailable`; leftover Owner write maps leftover `unavailable` → leftover `unvalidated` |

Keep the old names as one-line aliases until leftover Owner write, leftover M5, the barrel, leftover Owner UI spec copy, and leftover `ringCentralValidation.test.ts` migrate. Do not make callers learn leftover `validateWithPhoneNumberLoader` / leftover `loadAccessiblePhoneNumbers` / leftover `AccessiblePhoneNumberLoader` as the domain language.

**Principle: old exports stay as aliases.** `validateRingCentralNumberAgainstAccount` remains the imported name until leftover Owner write leftover `/validate` migrates. `createRingCentralAccountRouteValidator` remains the imported name until leftover M5 migrates. Stored leftover result `status` / leftover `code` strings stay those strings — leftover Owner write and leftover health already key on them.

**No class for the workflow.** The type that *does* earn a name is the leftover result leftover Owner write already leftover-stamps and leftover M5 already leftover-preflights:

```ts
type WhetherThisAccountCanSeeThisNumber =
  | {
      status: "valid"
      code: "RINGCENTRAL_NUMBER_ACCESSIBLE"
      message: string
      phoneNumberId?: string
      extensionId?: string
      queueId?: string
      queueName?: string
      observedTargetNames: string[]
    }
  | {
      status: "invalid"
      code: "RINGCENTRAL_NUMBER_NOT_FOUND" | "RINGCENTRAL_NUMBER_INVALID"
      message: string
    }
  | {
      status: "unavailable"
      code: "RINGCENTRAL_VALIDATION_UNAVAILABLE"
      message: string
    }
```

That is the handoff from “this account was asked” to “leftover Owner write may stamp the card, leftover M5 may refuse leftover apply, leftover Owner UI may refuse leftover activate.” Do **not** add leftover `validation_status` so “the ask owns the card,” do **not** add leftover `route_id` so “the ask owns leftover snapshot,” and do **not** drop leftover `unavailable` so “every failure is leftover not-found.”

Do not add leftover `withRegistryMutation` as a public **seam** — leftover `registryAudit.ts` already owns that. Do not add leftover `validateRingCentralRoute` as a public **seam** — leftover `ringCentralRegistry.ts` already owns that. Do not add leftover `loadRingCentralRouteSnapshot` as a public **seam** — leftover `ringCentralSnapshot.ts` already owns that. Do not add leftover `normalizePhoneNumberToE164Like` as a public **seam** — leftover `ringcentral/phone-normalization.ts` already owns that. Do not add leftover `ringCentralRequest` as a public **seam** — skipped leftover `client.ts` already owns that. Do not add leftover `getValidToken` as a public **seam** — already-recommended leftover `auth.ts` already owns that.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// ringCentralValidation.ts
// Before the Owner may turn a RingCentral inbound number on,
// this account must be able to see that number.
// Ask RingCentral for the phone book this process can read.
// Fold the presented number.
// Match it against that book.
// Valid returns provider ids and the observed target name.
// Missing or unfoldable is invalid.
// A failed ask is unavailable — do not pretend the number is missing.
// When M5 will ask about many numbers, load the book once.
// This file does not stamp the card.
// This file does not turn the number on.
// This file does not decide which incoming call becomes a Call Lead.

// ── 1. Ask if this account can see this number ────────────

export async function askRingCentralIfThisAccountCanSeeThisNumber(
  alreadyFoldedPhone: string,
): Promise<WhetherThisAccountCanSeeThisNumber>

async function foldAndMatchAgainstTheAccountPhoneBook(alreadyFoldedPhone, loadTheBook)
function refuseIfThePresentedNumberWillNotFold(alreadyFoldedPhone)  // invalid; do not load
function sayValidWithProviderIdsOrInvalidNotFound(records, alreadyFoldedPhone)
function sayUnavailableWhenTheAskFailed(error)  // 401/403 credentials; 429 rate limit; else retry later
function rememberQueueIdOnlyForACompanyOrTollFreeNumber(record)

// ── 2. Load the book once when many numbers will be asked ─

export function loadTheAccountPhoneBookOnceThenAskAboutManyNumbers(
  loadTheBook = loadThisAccountsPhoneBookFromRingCentral,
): AskWhetherThisAccountCanSeeThisNumber

async function loadThisAccountsPhoneBookFromRingCentral()  // 100 per page; stop at 20 pages or a short page
```

Read the primary path out loud: *The Owner presents a folded inbound number. Ask this RingCentral account for the phone book it can see. If the presented number will not fold, say invalid and do not call RingCentral. If the book does not hold that folded number, say invalid not-found. If RingCentral refused the ask — bad credentials, rate limit, or any other throw — say unavailable; do not pretend the number is missing. If it matches, say valid and hand back the provider ids and the observed target name. When M5 will ask about many numbers, load that book once and reuse it. Do not stamp the card. Do not turn the number on. Do not decide which incoming call becomes a Call Lead.*

That is the operation. `validateRingCentralNumberAgainstAccount` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Incoming is named `normalizedPhoneNumber` but the match does not fold it.** The first fold is a boolean gate. Inventory folds `record.phoneNumber` and compares that to the incoming string as-is. M5 seed phones are already `+1888…`. Owner write passes stored `route.phone_number` (folded on record). An unfolder incoming that still folds (`+1 (888) 308-3612`) loads the book and then returns `RINGCENTRAL_NUMBER_NOT_FOUND`, not `RINGCENTRAL_NUMBER_INVALID`. Do not silently fold both sides so “format variants match” without a paired Owner `/validate` + M5 seed test.

2. **Twenty pages is a silent not-found.** `loadAccessiblePhoneNumbers` stops at `page <= 20` of 100. A number on page 21 looks like `RINGCENTRAL_NUMBER_NOT_FOUND`. Owner activate and M5 apply then refuse. Do not silently raise the page cap so “we see every number” without a paired 429 test. Do not silently map overflow to `unavailable` so “health stays quiet” — overflow is not an HTTP fail.

3. **`unavailable` never throws.** Owner write stamps `unvalidated` (not `invalid`) and writes `ringcentral.route.validation_failed` `error` + notification candidate **after** commit. Health `registry.ringcentral_validation_failed` is `validation_status === "invalid"` only. An Owner who got `RINGCENTRAL_VALIDATION_UNAVAILABLE` looks unvalidated. Already-recommended leftover Owner write named this. Do not silently throw 401 so “the stamp does not land.” Do not silently return `invalid` on 401 so “health lights up.”

4. **An empty `records` page ends the book.** Missing `payload.records` becomes `[]` and breaks the loop. Every ask then returns not-found. That looks like “RingCentral does not have this number,” not “the ask returned no page.” Do not silently map an empty first page to `unavailable` so “we do not refuse activate on a parse miss” without a paired Owner `/validate` test.

5. **`queueId` is Company-or-TollFree only.** Valid Direct numbers return `extensionId` and omit `queueId`. Owner write copies both. Do not silently always set `queueId` so “every valid has a queue.”

6. **`queueName` falls through `features`.** `valueToString` joins a string array with `", "`. A features list can become `observedTargetNames`. Leftover last-seen `$addToSet` may copy that later. Do not silently drop `features` so “only extension names count” without a paired Owner stamp test.

7. **A shared rejected promise sticks.** `createRingCentralAccountRouteValidator` assigns `sharedLoad ??= loadPhoneNumbers()`. One throw makes every later ask on that factory return `unavailable` until M5 builds a new factory. M5 creates one factory per apply. Do not silently clear `sharedLoad` on reject so “retry loads again” without a paired M5 preflight test.

8. **There is no test for live per-ask, fold-miss, HTTP mapping, the `queueId` rule, or the page cap.** `ringCentralValidation.test.ts` proves one shared load and valid / not-found in parallel. Owner `/validate` proofs live on leftover `ringCentralRegistry.ts`, which has **no** file test. A later implementer must add the proofs below — do not treat M5 shared-load as live `validateRingCentralNumberAgainstAccount`.

9. **Leave sibling modules alone.** Leftover `validateRingCentralRoute`, leftover `loadRingCentralRouteSnapshot`, leftover `ringCentralRequest`, leftover `getValidToken`, leftover `normalizePhoneNumberToE164Like`, leftover health findings, leftover Granot `assertSingleActiveRingCentralAssignment`, leftover Call Qualification, and Wave B leftover `/validate` HTTP are already the right **depth**. This file orchestrates the account-inventory ask.

10. **Knowledge’s “`ringCentralRegistry.ts` / `ringCentralValidation.ts` — inbound-route snapshot used at Call Qualification time” sentence is leftover snapshot.** Do not “fix” that sentence in this rename by moving leftover `buildRingCentralRouteSnapshot` here or leftover `loadAccessiblePhoneNumbers` into leftover snapshot.

11. **Do not silently change result `status` / `code` strings.** `valid` / `invalid` / `unavailable` and `RINGCENTRAL_NUMBER_*` / `RINGCENTRAL_VALIDATION_UNAVAILABLE` are Owner-stamp keys and M5 preflight keys. Story names live on the functions. Re-label those stored values only as a separate, tested change.

## Testing

The **interface** is the test surface: `askRingCentralIfThisAccountCanSeeThisNumber`, `loadTheAccountPhoneBookOnceThenAskAboutManyNumbers`.

Today `ringCentralValidation.test.ts` proves one shared inventory load and valid + not-found in parallel. Keep that. Add tests that name the operation:

**Ask one number**
- Already-folded incoming matches a folded inventory `phoneNumber` → `valid` / `RINGCENTRAL_NUMBER_ACCESSIBLE`, `phoneNumberId`, `extensionId`, `observedTargetNames` from `extension.name`.
- CompanyNumber or TollFree sets `queueId` to `extension.id`. Other `usageType` omits `queueId`.
- Inventory miss → `invalid` / `RINGCENTRAL_NUMBER_NOT_FOUND`. The loader **was** called.
- Unfoldable incoming → `invalid` / `RINGCENTRAL_NUMBER_INVALID`. The loader **was not** called.
- Unfolder incoming that still folds (`+1 (888) 308-3612`) against folded inventory (`+18883083612`) returns not-found today. Keep that proof until a paired Owner `/validate` change re-folds both sides.

**Unavailable**
- `RingCentralApiError` 401 or 403 → `unavailable`, credentials message. 429 → rate-limit message. Other HTTP → `HTTP ${status}`. Non-API throw → temporarily unavailable. None of these throw to the caller.

**Share the book**
- Two parallel asks on one factory call the injected loader once (already on disk — keep the TBM Prime number and the missing sibling).
- A factory whose loader rejects returns `unavailable` for every later ask on that same factory.

Do **not** add a test per helper (`refuseIfThePresentedNumberWillNotFold`, `sayValidWithProviderIdsOrInvalidNotFound`, `rememberQueueIdOnlyForACompanyOrTollFreeNumber`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`createRingCentralAccountRouteValidator` stays exported because leftover M5 preflight is a second real **adapter**, not a test leak. The injectable loader stays injectable because the shared-load proof is a second real **adapter**. Do **not** retest leftover `normalizePhoneNumberToE164Like` or leftover `ringCentralRequest` 401 retry here.

## What I would not do

- A `RingCentralValidationService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap leftover `normalizePhoneNumberToE164Like` or leftover `ringCentralRequest`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `validate.ts`) for cleanliness.
- Breaking the live per-ask / shared-load / injected-result **seam**. Owner `/validate` must still hit RingCentral unless a validator is injected. M5 must still share one book across mappings.
- Treating leftover Owner inbound-number stamp, leftover inbound-number book, leftover Call Qualification, leftover Call Lead promote, leftover token mint, leftover HTTP-client 401 retry, leftover phone fold, leftover health findings, leftover Granot “exactly one assignment,” leftover Source Feed activate, leftover M5 apply orchestration, or Wave B `/validate` HTTP as this story.
- Inventing a **seam** that has only one **adapter**.
- Silently “fixing” a known gap while recommending a rename: do not re-fold incoming on match without a paired Owner `/validate` test; do not raise the page cap without a paired 429 test; do not throw 401 so the stamp does not land; do not return `invalid` on 401 so health lights up; do not map an empty first page to `unavailable` without a paired Owner `/validate` test; do not always set `queueId`; do not drop `features` from `queueName` without a paired stamp test; do not clear `sharedLoad` on reject without a paired M5 preflight test; do not move leftover `validateRingCentralRoute` or leftover snapshot build into this file; do not “fix” knowledge’s leftover registry/validation sentence by relocating leftover build; do not rename stored result `status` / `code` strings.
- Jumping to the next service while this one has unchecked modules.
- Writing a whole-folder recommendation for `operationsRegistry`.
