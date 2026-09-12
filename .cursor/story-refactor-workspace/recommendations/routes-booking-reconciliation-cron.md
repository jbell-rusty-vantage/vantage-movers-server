# After The Cron Secret Proves This Tick Is Ours, Wake The Still-Pending Employee-Job Rematch If The Flag Is On — Never Hold The Drain Here, Never Attach A Lead, Never Ask The Owner, Never Use The API Secret — operational story

- Status: recommended
- Service: `routes` (Wave B, in-progress)
- Pass: 20 of this service — `booking-reconciliation-cron.routes.ts`
- Remaining in this service: `sheet-sync-cron.routes.ts`, `lead-messaging-cron.routes.ts`, `cpl-correction-cron.routes.ts`, `notification-cron.routes.ts`, `best-relocation-ingestion-cron.routes.ts`, `reporting-cron.routes.ts`, `granot-automation-cron.routes.ts`, `granot-lifecycle-cron.routes.ts`
- Target: `src/routes/booking-reconciliation-cron.routes.ts`
- Knowledge: [`docs/knowledge/services/employee-bookings.md`](../../../docs/knowledge/services/employee-bookings.md) (HTTP/cron table: `ALL /api/cron/booking-reconciliation-rematch`, `CRON_SECRET`, **no-op unless auto-rematch is enabled**. Auto-rematch section: `BOOKING_RECONCILIATION_AUTO_REMATCH_ENABLED` is **on unless the env is the string `false`**; default reason list is only `matching_unavailable`; delays `5,30,120`; the cron skips entirely when the flag is off). The Service `applies_to` list names submit / matcher / Owner desk / matching + rematch config — **it does not name this file**. Do not invent a Routes Service. Distinct from already-recommended rematch drain: [employee-bookings-reconciliation-rematch.md](employee-bookings-reconciliation-rematch.md) (`runDueBookingLeadRematches` — this file **asks** it after the flag with `actor: "cron"`; that file holds global `booking-reconciliation:rematch`, claims due pending cases, **asks** the operational finder + matcher, delayed-attaches without `sourceResolution`; **this file never claims a case and never attaches**). Distinct from already-recommended Owner desk: [employee-bookings-booking-lead-reconciliation.md](employee-bookings-booking-lead-reconciliation.md) (`GET/POST/PATCH /api/v1/admin/booking-lead-reconciliations*` after `deriveTrustedOwnerActor` — **does not import** this file; Owner search is any-known-contact; rematch **asks** the operational six lookups). Distinct from already-recommended attach write: [employee-bookings-booking-lead-attachment.md](employee-bookings-booking-lead-attachment.md) (rematch **asks** `auto_attach_delayed`; **this file never imports it**). Distinct from already-recommended submit: [employee-bookings-submit-employee-booking.md](employee-bookings-submit-employee-booking.md) (opens `next_attempt_at` when rematch is on and the reason is listed — **does not import** this file). Distinct from already-recommended Owner mount: [routes-v1.md](routes-v1.md) (Owner `booking-lead-reconciliations*` after `requireApiSecret` — **does not import** this file). Distinct from already-recommended Granot Booking case: [granot-lifecycle-booking-reconciliation.md](granot-lifecycle-booking-reconciliation.md) (`granot_booking_reconciliation_cases` — **different collection**; **this file never opens a Granot case**). Distinct from rematch config: `bookingReconciliation.ts` (`getBookingReconciliationConfig`. `autoRematchEnabled` defaults **on** — this file **asks** that **before** rematch). Distinct from sibling crons: already-recommended [routes-ringcentral-cron.md](routes-ringcentral-cron.md) (Call Log `lease_held` **200** + factory inject; flags default **false** — **does not import** this file) / next `sheet-sync-cron.routes.ts` / `lead-messaging-cron.routes.ts` / `cpl-correction-cron.routes.ts` / `notification-cron.routes.ts` / `best-relocation-ingestion-cron.routes.ts` / `reporting-cron.routes.ts` / `granot-automation-cron.routes.ts` / `granot-lifecycle-cron.routes.ts` (each copies `requireCronAuth`; **none import** this file). Distinct from already-recommended letters: [observability-record-operational-event.md](observability-record-operational-event.md) (rematch **asks** `booking.lead_reconciliation.retry_failed` / `booking.lead_reconciliation.resolved`; **this file never asks letters**). Distinct from other secrets: `requireApiSecret` / Owner HMAC / Granot webhook secret / Twilio signature / RingCentral Validation-Token / live-host `x-debug-token` (**this file never uses those**). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Booking](../../../../CONTEXT.md); pointer terms are `employee booking submission` / `booking lead reconciliation case` / `employee booking origin` / `matching unavailable`; do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Project-organization names `daily-operations-admin.routes.ts`; this checkout has no such file and no `src/services/dailyOperations/` — do not invent that mount. Do not add a Routes Service file in this rename.
- Callers: **one runtime mount plus one HTTP test harness.** `src/app.ts` **asks** the default export (`app.use(bookingReconciliationCronRoutes)` on line 57 — **after** RingCentral inbound / Granot inbound / RingCentral local / already-recommended RingCentral cron, **before** next sheet-sync / lead-messaging / CPL / notification crons, Twilio desks, Best Relocation / reporting / Granot automation / Granot lifecycle crons, Granot automation, public v1). `src/routes/booking-reconciliation-cron.routes.test.ts` **asks** the live default export — missing `CRON_SECRET` **500**, Bearer mismatch **401**. Operator `hit-vantage-api` lists Owner `GET/POST/PATCH /api/v1/admin/booking-lead-reconciliations*`, **not** `/api/cron/booking-reconciliation-rematch`. Host public/unguarded tables omit this path. Not this **interface**: `runDueBookingLeadRematches` itself, `getBookingReconciliationConfig` itself, `attachLeadToEmployeeBooking` itself, Owner `resolveBookingLeadReconciliation` itself, `submitEmployeeBooking` itself, `acquireLease` itself.
- Seams callers need: `CRON_SECRET` Bearer **or** `x-cron-secret` vs `requireApiSecret` vs Owner HMAC vs Granot webhook secret vs RingCentral Validation-Token vs Twilio signature; disabled **200** `{ skipped: true, reason: "auto rematch disabled" }` vs rematch zeros `{ claimed: 0, attached: 0, updated: 0, skipped: 0 }` vs RingCentral `lease_held` **200** skipped vs rematch throw as unhandled Express; no factory inject vs already-recommended `createRingCentralCronRouter`; `router.all` (Vercel GET) vs webhook POST-only; flag default **on** (`!== "false"`) vs RingCentral flags default **false**. There is no begin / complete Domain Command **seam**. There is no Zod **seam**. There is no HMAC Owner **seam**. There is no Validation-Token **seam**. There is no factory inject **seam**.
- Split later (only if the file outgrows one sitting): this ~38-line file is one sitting if you read it as after the cron secret proves this tick is ours, wake the still-pending employee-Job rematch if the flag is on — never hold the drain here, never attach a Lead, never ask the Owner, never use the API secret. Do not split. Never `get.ts` / `post.ts` / `cron.ts` / `rematch.ts` / `create.ts` / `update.ts` / `delete.ts`. Rematch stays already-recommended `reconciliationRematch.service.ts`. Owner desk stays already-recommended `bookingLeadReconciliation.service.ts`. Attach stays already-recommended `bookingLeadAttachment.service.ts`. Flag stays `getBookingReconciliationConfig`. Sheet Sync drain stays next `sheet-sync-cron.routes.ts`.

`router.all("/api/cron/booking-reconciliation-rematch")` is an HTTP verb. The owner question is: *Vercel just woke us — or a local operator used the same secret. Prove Bearer or `x-cron-secret` matches `CRON_SECRET`. If the secret is missing, say the cron is misconfigured — do not pretend this is unauthorized. If it does not match, refuse it. If rematch is off, answer skipped and do not ask the rematch — Mongo must not see a drain claim. If it is on, ask the rematch with actor `cron` and echo the four counts. Do not hold the drain in this file. Do not claim a case. Do not attach a Lead. Do not ask the Owner to name a Lead or a warning. Do not compare `x-api-secret`.*

Who hold the one rematch drain / claim each due case / ask the operational matcher / delayed-attach already lives in already-recommended `reconciliationRematch.service.ts`. Who name the flag already lives in `getBookingReconciliationConfig`. Who work the Owner desk already lives in already-recommended `bookingLeadReconciliation.service.ts`. Do not pull those in.

## What this file actually does

One operation of one “after the cron secret proves this tick is ours, wake the still-pending employee-Job rematch if the flag is on” story, not “a cron CRUD dump,” and not Retry The Still-Pending Employee Job / Work The Owner Desk / Book The Employee Job themselves:

1. **Wake this employee-Job rematch — or skip because the flag is off** — `ALL /api/cron/booking-reconciliation-rematch`. `requireCronAuth` first. Missing `CRON_SECRET` **500** `{ ok: false, error: "CRON_SECRET is not set" }`. Mismatch **401** `{ ok: false, error: "Unauthorized" }`. Then `getBookingReconciliationConfig()`. `!config.autoRematchEnabled` **200** `{ ok: true, skipped: true, reason: "auto rematch disabled" }` and **does not ask** `runDueBookingLeadRematches` — knowledge: the cron skips entirely when rematch is off; Wave A rematch already said the route refuses **before** calling that file. Else **asks** `runDueBookingLeadRematches({ actor: "cron" })` and **200** `{ ok: true, skipped: false, summary }` (Wave A four counts: `claimed` / `attached` / `updated` / `skipped`). This beat does **not** map a global lease miss onto HTTP `{ skipped: true, reason: "lease_held" }` — rematch returns zeros and this file echoes `skipped: false`. This beat does **not** wrap rematch in try/catch — a lost seat or cold Mongo throw is unhandled Express (`app.ts` only maps malformed JSON to **400**; other throws `next(err)`). This beat does **not** **ask** `acquireLease`. This beat does **not** **ask** `attachLeadToEmployeeBooking`. This beat does **not** **ask** `resolveBookingLeadReconciliation`. This beat does **not** **ask** `recordOperationalEvent`. This beat does **not** compare `x-api-secret`.

`requireCronAuth` is a beat inside this operation, not an extra owner story. The default export is the live `Router()` instance — there is **no** factory inject.

There is no second hold-the-drain operation. Wave A rematch elects `booking-reconciliation:rematch`. There is no third Owner attach / mint operation. There is no fourth public employee submit operation. There is no fifth Granot Booking-case operation. There is no sixth Sheet Sync drain operation.

## Organization

Keep one file. This is the screenplay for “after the cron secret proves this tick is ours, wake the still-pending employee-Job rematch if the flag is on — never hold the drain here, never attach a Lead, never ask the Owner, never use the API secret.” Already-recommended rematch / Owner desk / attach / submit / the flag already live in deeper **modules**. Do not pull those in. Do not invent a `BookingReconciliationCronRoutesService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a factory inject **adapter** so “this desk matches RingCentral AC-17” without a paired HTTP proof that the live default still **asks** Wave A rematch. Do not invent a Zod **adapter** so “cron ticks 400 on unknown keys.” Do not invent an HMAC **adapter** so “cron matches Owner desks.” Do not invent a lease **adapter** beside already-recommended rematch `acquireLease`. Do not invent a CRUD folder so `rematch.ts` / `cron.ts` each get a file.

Do not move `runDueBookingLeadRematches` into this file so “the route owns the drain.” Do not move `requireCronAuth` into `middleware/` in this rename so “one helper owns every cron” without a paired HTTP proof on **every** sibling cron. Do not mount this router inside `v1.routes.ts` so “one file owns every cron.” Do not merge this router into already-recommended Owner `booking-lead-reconciliations*` so “one file owns hybrid employee-Job attach.” Do not merge this router into next `sheet-sync-cron.routes.ts` so “one file owns every five-minute `CRON_SECRET` tick.” Do not merge this router into already-recommended RingCentral cron so “one file owns every `lease_held`.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `default` router | `employeeJobRematchCronDesk` | `app.ts` mounts the instance **after** RingCentral cron, **before** next sheet-sync cron |
| `ALL /api/cron/booking-reconciliation-rematch` (today unexported handler) | `wakeThisEmployeeJobRematchOverHttp` | flag **then** rematch **or** skipped |

Keep the default export as a one-line alias until `app.ts` migrates. Do not make callers learn `autoRematchEnabled` / `autoRematchReasons` / `lease_owner` as the domain language. Do **not** export `requireCronAuth` so “the test can unit the helper.” Do **not** add `createBookingReconciliationCronRouter({ runRematch, rematchEnabled })` in this rename so “this desk matches RingCentral” without a paired HTTP proof that the live default still **asks** `runDueBookingLeadRematches`.

**No class for the workflow.** The one type that *does* earn a name is the HTTP handoff after rematch is off:

```ts
type EmployeeJobRematchSkippedBecauseTheFlagIsOffOverHttp = {
  ok: true
  skipped: true
  reason: "auto rematch disabled"
}
```

That is the **200** handoff from “Vercel woke us while rematch is off” to “do not claim the drain.” Do **not** collapse rematch zeros (`{ claimed: 0, attached: 0, updated: 0, skipped: 0 }` with HTTP `skipped: false`) into this skip so “one skip owns disabled and a held seat.” Do **not** copy RingCentral `{ reason: "lease_held" }` onto this desk so “every cron maps overlap.” Do **not** add `cases[]` onto the **200** so “the owner can see every pending Job on the cron body.”

Leave `runDueBookingLeadRematches` on already-recommended rematch. Leave `getBookingReconciliationConfig` on `bookingReconciliation.ts`. Leave the Owner desk on already-recommended `bookingLeadReconciliation.service.ts`. Leave attach on already-recommended `bookingLeadAttachment.service.ts`. Leave sibling crons on their next files.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// booking-reconciliation-cron.routes.ts
// Vercel just woke us — or a local operator used the same secret.
// Prove Bearer or x-cron-secret matches CRON_SECRET.
// If the secret is missing, say the cron is misconfigured.
// If it does not match, refuse it.
// If rematch is off, answer skipped and do not ask the rematch.
// If it is on, ask the rematch with actor cron and echo the four counts.
// Do not hold the drain in this file.
// Do not claim a case.
// Do not attach a Lead.
// Do not ask the Owner.
// Do not compare x-api-secret.

export default acceptThisEmployeeJobRematchCronDesk()

function acceptThisEmployeeJobRematchCronDesk() {
  const desk = Router()
  desk.all(
    "/api/cron/booking-reconciliation-rematch",
    proveThisCronTickIsOurs,
    wakeThisEmployeeJobRematchOverHttp,
  )
  return desk
}

// ── 1. Wake this employee-Job rematch ─────────────────────

async function wakeThisEmployeeJobRematchOverHttp(_req, res) {
  if (!employeeJobRematchIsOn()) {
    return skippedBecauseRematchIsOff(res)
  }

  const summary = await retryDuePendingEmployeeJobsUntilAUniqueLeadAppears({
    actor: "cron",
  })
  return theRematchFinished(res, summary)
}

function employeeJobRematchIsOn() {
  return getBookingReconciliationConfig().autoRematchEnabled
}

function proveThisCronTickIsOurs(req, res, next) {
  const expected = readTheCronSecret()
  if (!expected) {
    return cronIsMisconfigured(res)
  }
  if (bearerMatches(req, expected) || headerSecretMatches(req, expected)) {
    return next()
  }
  return refuseAnUnauthorizedCronTick(res)
}
```

Read the desk path out loud: *Prove Bearer or `x-cron-secret` matches `CRON_SECRET`. Missing secret is 500, not 401. A mismatch is 401. If rematch is off, 200 skipped and do not ask rematch — Mongo must not see a drain claim. If it is on, ask rematch with `actor: "cron"` and echo the four counts. A held seat is zeros with HTTP `skipped: false`, not `lease_held`. A rematch throw is unhandled Express. Do not hold the drain. Do not attach a Lead. Do not ask the Owner. Do not compare `x-api-secret`.*

That is the operation. `router.all("/api/cron/booking-reconciliation-rematch")` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The route and rematch both refuse when rematch is off.** This file **200** `{ skipped: true }` and never **asks**. Wave A rematch still returns zeros if a script hits the barrel. Wave A rematch already said leave both. Do not delete this fence so “the service already checked.” Do not skip the rematch fence so “the route owns the flag.”

2. **Rematch defaults on.** `autoRematchEnabled` is `env !== "false"`. Already-recommended RingCentral Call Log / snapshot flags default **false**. Knowledge locks this default. Do not default rematch off so “this desk matches Call Log dormant deploy.”

3. **`getBookingReconciliationConfig()` parses reasons / delays / batch before the flag branch.** A disabled tick with a bad `BOOKING_RECONCILIATION_AUTO_REMATCH_REASONS` still throws (unknown reason / empty list). That throw is unhandled Express. Do not split `autoRematchEnabled` into its own reader in this rename so “disabled never parses reasons” without a paired HTTP proof that Wave A rematch and submit still share one config object. Park the parse.

4. **A held rematch seat is not HTTP `lease_held`.** Rematch miss returns `{ claimed: 0, attached: 0, updated: 0, skipped: 0 }`. This file **200** `{ skipped: false, summary }`. Already-recommended Call Log maps `summary.skipReason === "lease_held"` onto **200** `{ skipped: true, reason: "lease_held" }`. Do not copy that map here so “every cron elects the same skip.” Do not **500** the zeros so “overlap looks like failure.”

5. **This desk has no try/catch.** Next `sheet-sync-cron.routes.ts` **500**s `error.message`. Already-recommended Call Log **500**s generic `"Call log sync failed"`. Rematch lost-seat / cold-Mongo throw here is unhandled Express. Rematch already persisted `retry_failed` / drain `resolved` letters inside Wave A. Do not add a catch so “this desk matches sheet-sync echo” without a paired HTTP proof that Vercel retries stay bounded. Do not add generic `"Rematch failed"` so “one refuse owns every cron.”

6. **There is no factory inject.** Already-recommended Call Log AC-17 **asks** `createRingCentralCronRouter`. Today’s harness mounts the live default and only proves auth. Disabled skip is already testable by setting `BOOKING_RECONCILIATION_AUTO_REMATCH_ENABLED=false` — `getBookingReconciliationConfig` reads env at request time, and this file will not **ask** rematch. Do not add `createBookingReconciliationCronRouter` in this rename so “this desk matches RingCentral” without a paired HTTP proof that `app.ts` still mounts the live default. Add the disabled-skip proof at this **interface**.

7. **`requireCronAuth` is a copy of sibling crons.** Sheet-sync / RingCentral / lead-messaging / Granot lifecycle use the same Bearer-or-header 500/401. Reporting 503s `"CRON_SECRET is not configured."` CPL uses `"CRON_SECRET is not configured"`. Do not extract shared `middleware/requireCronAuth.ts` in this rename so “one helper owns every cron” without a paired HTTP proof on **this** desk **and** the siblings. Park the copy.

8. **`router.all` is GET-and-POST, not POST-only.** Knowledge names `ALL`. Vercel cron GETs. Today’s harness POSTs only. Do not switch `router.post` so “cron matches Twilio.” Do not **405** GET so “one verb owns every tick.”

9. **Actor is the string `"cron"`.** Rematch never asks `deriveTrustedOwnerActor`. Do not stamp `owner:cron` so “history looks like the desk.” Do not import Owner HMAC so “someone must be an Owner.”

10. **This desk never attaches, never mints, never asks Owner search, and never talks Granot.** Rematch **asks** delayed attach. The Owner desk **asks** attach / mint / reassign. This file **asks** one export. Do not **ask** `attachLeadToEmployeeBooking` from this file so “one hop owns the Lead.” Do not merge this router into already-recommended Owner `booking-lead-reconciliations*` so “one file owns hybrid employee-Job attach.” Do not open a Granot Booking case so “one reconciliation owns every Job.”

11. **This desk never uses `x-api-secret`, Owner HMAC, Granot webhook secret, Twilio signature, RingCentral Validation-Token, or live-host `x-debug-token`.** `app.ts` mounts **before** `v1Routes`. `CRON_SECRET` is the handshake. Do not remount `requireApiSecret` so “it matches reporting.” Do not hide this ALL behind Owner HMAC so “cron matches leftover admin.”

12. **Host tables and `hit-vantage-api` omit `/api/cron/booking-reconciliation-rematch` and list the Owner desk.** That skill is `x-api-secret` desks. Do not add the cron path to `hit-vantage-api` in this rename. Do not remount `requireApiSecret` so “the host table wins.”

13. **Today’s harness never wakes rematch and never proves the disabled skip.** Auth 500/401 only. `vercel.json` `*/5 * * * *` is the only cadence proof. Do not treat schedule-parse as HTTP rematch. Add flag-off **200** `{ skipped: true, reason: "auto rematch disabled" }` at `wakeThisEmployeeJobRematchOverHttp`. Enabled four-count **200** stays on already-recommended rematch tests unless a later factory inject exists with a live-default proof.

14. **Leave sibling modules alone.** `runDueBookingLeadRematches` / `getBookingReconciliationConfig` are already the right **depth**. This file orchestrates the HTTP **adapter**.

15. **Do not treat Owner desk / public submit / Granot Booking case / Sheet Sync drain / Call Log sweep / Lead Messaging drain / Granot lifecycle drain as this story.** Next `sheet-sync-cron.routes.ts` is the outbox safety net. Later `lead-messaging-cron.routes.ts` is due SMS. Do not teach this file `database_scope`.

## Testing

The **interface** is the test surface: `employeeJobRematchCronDesk` (mounted on `app.ts` **after** RingCentral cron, **before** next sheet-sync cron as the default export) and the one HTTP operation above.

Today `booking-reconciliation-cron.routes.test.ts` names missing-secret **500** and Bearer-mismatch **401** through the live default. Keep those proofs. Add the disabled skip at the same **interface** (do not boot rematch, do not claim a case in the route file):

**Handshake / who may speak**
- Missing `CRON_SECRET` **500** `"CRON_SECRET is not set"`.
- Bearer mismatch **401** `"Unauthorized"`.
- Matching `x-cron-secret` **200**.
- `requireApiSecret` / Owner HMAC / Granot webhook secret / Twilio signature / RingCentral Validation-Token / `x-debug-token` are **not** accepted here.

**Wake rematch — never hold the drain here**
- `BOOKING_RECONCILIATION_AUTO_REMATCH_ENABLED=false` **200** `{ ok: true, skipped: true, reason: "auto rematch disabled" }` and never **asks** rematch (no Mongo connect from this tick).
- Enabled success **200** `{ skipped: false, summary }` echoes the four counts and is PII-free (no phone / Lead id / Bearer / token). Prove the four counts on already-recommended rematch unless a later factory inject exists.
- A held rematch seat is **200** `{ skipped: false, summary: { claimed: 0, attached: 0, updated: 0, skipped: 0 } }`, not `{ reason: "lease_held" }`. That mapping lives in rematch, not here — do not invent it on this desk.
- This beat does **not** **ask** `acquireLease` / `attachLeadToEmployeeBooking` / `resolveBookingLeadReconciliation` / `recordOperationalEvent`.

**Cadence**
- `vercel.json` `/api/cron/booking-reconciliation-rematch` is `*/5 * * * *`.
- `router.all` accepts GET and POST.

**Mount**
- `app.ts` should keep `app.use(bookingReconciliationCronRoutes)` after RingCentral cron, before next sheet-sync cron / `v1Routes`.
- Already-recommended Owner `booking-lead-reconciliations*` and next sheet-sync drain stay mounted apart.

**Not this file**
- Rematch stays on already-recommended [employee-bookings-reconciliation-rematch.md](employee-bookings-reconciliation-rematch.md).
- Owner desk stays on already-recommended [employee-bookings-booking-lead-reconciliation.md](employee-bookings-booking-lead-reconciliation.md).
- Attach stays on already-recommended [employee-bookings-booking-lead-attachment.md](employee-bookings-booking-lead-attachment.md).
- Submit stays on already-recommended [employee-bookings-submit-employee-booking.md](employee-bookings-submit-employee-booking.md).
- Letters persist stays on already-recommended [observability-record-operational-event.md](observability-record-operational-event.md).

Do **not** add a test per helper (`proveThisCronTickIsOurs`, `employeeJobRematchIsOn`, `skippedBecauseRematchIsOff`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** invent a factory so “the test can no longer see the live Wave A default.” `app.ts` must still **ask** the default export.

## What I would not do

- A `BookingReconciliationCronRoutesService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `res.json({ ok: true, skipped: false, summary })`.
- Moving this into a CRUD folder (`get.ts` / `post.ts` / `cron.ts` / `rematch.ts` / `create.ts` / `update.ts` / `delete.ts`) “for cleanliness.”
- Breaking the disabled-never-claims **seam**: do not **ask** rematch when the flag is false.
- Breaking the held-seat **seam**: do not map rematch zeros onto HTTP `lease_held`, and do not **500** overlap.
- Breaking the cron-secret **seam**: do not remount `requireApiSecret` or admit HMAC / Granot webhook secret / Twilio signature / RingCentral Validation-Token / `x-debug-token` here.
- Treating `runDueBookingLeadRematches`, `attachLeadToEmployeeBooking`, Owner `resolveBookingLeadReconciliation`, `submitEmployeeBooking`, Granot Booking cases, next sheet-sync drain, Call Log sweep, Lead Messaging drain, Granot lifecycle drain, or public v1 as this story.
- Inventing a shared-cron-auth / Domain Command / Zod / factory inject **adapter** that has only one caller in this pass.
- Silently flipping rematch to default-off, copying RingCentral `lease_held`, merging this router into the Owner desk, attaching a Lead, remounting `requireApiSecret`, or extracting `requireCronAuth` while recommending a rename.
- Jumping to `models/` / `validation/` / `config/domain/` / `middleware/` / `auth/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `routes`.
