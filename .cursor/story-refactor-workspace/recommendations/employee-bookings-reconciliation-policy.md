# Say Whether This Owner May Do This To The Already-Booked Employee Job — Name Who Is Speaking, Name Every Overrideable Warning Exactly, Then Refuse The Act Unless Both The Case Status And The Live Booking Allow It — Never Override A Cancelled Or Already-Booked Lead, Never Treat Registry HMAC As This Gate, Never Page The Queue — operational story

- Status: recommended
- Service: `employeeBookings` (Wave A, in-progress)
- Pass: 6 of this service — `reconciliationPolicy.ts`
- Remaining in this service: `reconciliationRematch.service.ts`, `migrationPreflight.ts`, `migrationApplySafety.ts`
- Target: `src/services/employeeBookings/reconciliationPolicy.ts`
- Knowledge: [`docs/knowledge/services/employee-bookings.md`](../../../docs/knowledge/services/employee-bookings.md) (`applies_to` names this file; Owner case-status table + live Booking fence + exact overrideable warnings). This checkout’s `CONTEXT.md` defines `employee booking submission`, `booking lead reconciliation case`, `employee booking origin`, and `matching unavailable` — link those terms; do not invent a second glossary. `docs/adr/` is absent here — do not invent ADR copies. This gate is **not** Registry `requireRegistryOwnerActor`, **not** Drive owner-email, and **not** Granot Booking-case policy.
- Callers: Wave B `v1.routes.ts` (`requireOwnerActor` → `deriveTrustedOwnerActor` on every `GET/POST/PATCH /api/v1/admin/booking-lead-reconciliations*` **and** Owner-only `POST .../sheet-sync/contains`). Already-recommended desk `bookingLeadReconciliation.service.ts` (`assertAllowedCaseAction`, `assertLiveBookingState`, `assertExactWarningOverrides`, encode/decode cursor). Barrel does **not** re-export this file. Rematch, attach, and submit do **not** import it. Tests: `reconciliationPolicy.test.ts` (actor, exact overrides, case-status, live Booking, cursor). Desk tests only source-read the two assert names on reopen.
- Seams callers need: who-is-speaking (route gate + actor stamp) vs the two-axis act fence (case status, then live Booking) vs exact warning overrides (attach / reassign only). Encode/decode cursor is browse / Owner-search pagination, not a fourth owner story. There is no persist **seam**.
- Split later (only if the file outgrows one sitting): `sayWhoIsSpeakingAsThisEmployeeJobOwner.ts`, `refuseUnlessThisOwnerMayDoThisAct.ts` — never `create.ts` / `update.ts` / `delete.ts` / `auth.ts`. Desk, attach, rematch, and submit stay siblings.

`deriveTrustedOwnerActor` / `assertAllowedCaseAction` / `assertLiveBookingState` / `assertExactWarningOverrides` are executor mechanics. The owner question is: *Someone wants to work an already-booked employee Job. First say they are an Owner — an extension Owner Bearer, or the API secret plus owner admin headers. Then, if they named a Lead, they must list every overrideable warning on that Lead exactly — a cancelled Lead or a Lead already booked on another Job is not a warning they can talk past. Then refuse the act unless both the case status and the live Booking allow it. A cancelled Booking is inspect or dismiss only. An attached Booking changes Lead only by reassign. This file does not claim. This file does not book. This file does not page the queue.*

## What this file actually does

Four operations of one “say whether this Owner may do this to the already-booked employee Job” story, not “a CRUD policy helper,” and not Book The Employee Job:

1. **Say who is speaking as this employee-Job Owner** — extension `user` with role `owner` → `{ actor: owner:<userId>, ownerId, ownerEmail }`. Else API `secret` plus trimmed `adminUserId` / lowercased `adminEmail` / `adminRole === "owner"` → `{ actor: owner:<email>, ownerId, ownerEmail }`. Anyone else, including bare secret, Sales, Customer Service, or admin-role headers → 403 `Forbidden`. No HMAC. No Drive email. No Registry Change.
2. **Refuse unless the Owner named every overrideable warning exactly** — keep the six overrideable codes (`duplicate_lead`, `source_conflict`, `channel_conflict`, `source_unassigned`, `same_company_legacy`, `created_on_unmatched`). Fold live warnings to those six, unique + sort. Fold what the Owner sent the same way (unknown strings drop; hard-block codes stay in the provided set). Length or any slot differs → 409 naming the required list or `none`. `lead_already_booked` and `lead_cancelled` are known codes and are **not** overrideable.
3. **Refuse unless this case status allows this act** — `pending` → dismiss / attach / mint / correct-pending. `dismissed` → attach / reassign / reopen. `resolved` → reassign / reopen. Anything else → 409 `Case status … does not allow …`.
4. **Refuse unless this live Booking allows this act** — cancelled → only reopen / dismiss. Already attached → cannot attach / mint / correct-pending / dismiss / reopen. Reassign requires an attached Lead. Else 409 (`Booking is cancelled` / `already attached to a lead` / `no attached lead to reassign`).

Finding the Lead, claiming it, minting it, opening the case, rematch cron, and paging the Owner queue are other files. This file never writes Mongo, never POSTs Granot, and never opens a Granot Booking case.

Encode / decode / in-memory date+id cursor is pagination the desk already uses for browse and Owner search. It is not an owner act. `applyCursorFilter` has no runtime caller.

## Organization

Keep one file. This is the screenplay for “may this Owner do this to this already-booked Job.” Who-is-speaking, the warning list, and the two-axis fence belong together because attach / reassign must pass all three before the desk calls the attachment sibling. Do not pull the desk, attach, rematch, or Registry HMAC in. Do not invent a `ReconciliationPolicyService` class. Do not invent a begin / complete **seam** — this file never writes.

If it later outgrows one sitting, split by the two stories above (who is speaking vs may they do this act), never CRUD and never one file per warning code. Leave encode/decode in this file as aliases until the desk migrates; do not promote them to a cursor **module** in this pass.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `deriveTrustedOwnerActor` | `sayWhoIsSpeakingAsThisEmployeeJobOwner` | Wave B route gate + actor stamp; weaker than Registry HMAC |
| `assertExactWarningOverrides` | `refuseUnlessTheOwnerNamedEveryOverrideableWarningExactly` | Owner attach / reassign; command attach has no overrides |
| `assertAllowedCaseAction` | `refuseUnlessThisCaseStatusAllowsThisAct` | resolve + reopen |
| `assertLiveBookingState` | `refuseUnlessThisLiveBookingAllowsThisAct` | resolve + reopen + correct-pending |
| `OVERRIDEABLE_RECONCILIATION_WARNINGS` | `theWarningsThisOwnerMayOverride` | the six codes; keep the const string values |
| `getOverrideableWarnings` | keep as alias of the fold inside exact-match | unused desk import; do not promote |
| `normalizeWarningCodes` | keep as alias / fold | exact-match uses it; do not export as domain language |
| `encodeDateIdCursor` / `decodeDateIdCursor` | keep as aliases | browse + Owner search pages; not this story |
| `applyCursorFilter` | keep as alias only | unused at runtime; do not promote |

Keep the old names as one-line aliases until the route helper and the desk migrate. Do not make callers learn `InTransaction` or `deriveTrusted` as the domain language. Do not export a combined `assertTheOwnerMayDoThisAct` that hides which axis failed.

**No class for the workflow.** The one type that earns a name is the speaker bag:

```ts
type WhoIsSpeakingAsThisEmployeeJobOwner = {
  actor: string
  ownerId?: string
  ownerEmail?: string
}
```

That is the handoff from “this request may continue” to “the desk can stamp `resolution_history.actor`.” Do **not** add HMAC fields so “this is Registry.” Do **not** add `kind: "scoped_key"`. Leave `EmployeeBookingActorContext` on sibling `types.ts` — it is the same shape the desk already threads.

Leave `assertLeadAttachable` / `deriveLiveLeadWarnings` on the desk. Those name the Lead, not the Owner. Leave `assertLiveBookingStateForAction` on the desk — it only reads `cancelled` / `lead_ref` off the Booking document.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// reconciliationPolicy.ts
// Someone wants to work an already-booked employee Job.
// First say they are an Owner.
// If they named a Lead, they must list every overrideable warning exactly.
// A cancelled Lead or a Lead already booked on another Job
// is not a warning they can talk past.
// Then refuse the act unless both the case status
// and the live Booking allow it.
// A cancelled Booking is inspect or dismiss only.
// An attached Booking changes Lead only by reassign.
// Book The Employee Job, Registry HMAC, and Granot Owner Confirm
// are other files.

// ── 1. Say who is speaking as this employee-Job Owner ─────

export function sayWhoIsSpeakingAsThisEmployeeJobOwner(auth, headers)
  // extension Owner Bearer → actor owner:<userId>
  // secret + owner admin headers → actor owner:<lowercased email>
  // bare secret / Sales / Customer Service / admin-role headers → 403

function theyAreAnExtensionOwner(auth)
function theySentOwnerAdminHeadersWithTheApiSecret(auth, headers)

// ── 2. Refuse unless every overrideable warning is named exactly

export const theWarningsThisOwnerMayOverride = [
  "duplicate_lead",
  "source_conflict",
  "channel_conflict",
  "source_unassigned",
  "same_company_legacy",
  "created_on_unmatched",
] as const

const warningsThisOwnerCannotTalkPast = [
  "lead_already_booked",
  "lead_cancelled",
] as const

export function refuseUnlessTheOwnerNamedEveryOverrideableWarningExactly(
  liveWarnings,
  warningsTheOwnerNamed,
)
  // required = unique sorted overrideable subset of live
  // provided = unique sorted known codes the Owner sent
  // mismatch → 409 listing required or "none"

function theOverrideableWarningsOnThisLead(warnings)
function theKnownWarningCodes(warnings)   // drops unknown strings

// ── 3. Refuse unless this case status allows this act ─────

export function refuseUnlessThisCaseStatusAllowsThisAct(status, action)
  // pending → dismiss / attach_existing / create_and_attach / update_pending
  // dismissed → attach_existing / reassign / reopen
  // resolved → reassign / reopen

// ── 4. Refuse unless this live Booking allows this act ────

export function refuseUnlessThisLiveBookingAllowsThisAct({
  cancelled,
  hasLead,
  action,
})
  // cancelled → reopen / dismiss only
  // hasLead → cannot attach / mint / correct-pending / dismiss / reopen
  // reassign → hasLead required

// ── not this story (keep as aliases) ──────────────────────

export function encodeDateIdCursor(date, id)
export function decodeDateIdCursor(cursor)   // 400 Invalid cursor
export function applyCursorFilter(items, cursor, direction)  // unused in prod
```

Read the path out loud: *Say they are an Owner. If they are attaching or reassigning, they must name every overrideable warning on that Lead exactly — they cannot talk past a cancelled Lead or a Lead already booked elsewhere. Then look at the case: pending may dismiss, attach, mint, or correct the Job; dismissed may attach, reassign, or reopen; resolved may reassign or reopen. Then look at the live Booking: cancelled is inspect or dismiss; already attached changes Lead only by reassign. Hand the speaker bag back. Do not claim. Do not book. Do not page the queue.*

That is the operation. `assertAllowedCaseAction` is not.

The desk says the next sentence after this file returns: attach, mint, reassign, dismiss, correct-pending, or reopen. Rematch never asks this file. Submit never asks this file.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Two axes, two functions, both required.** Case status can allow `reassign` on `dismissed` while live Booking refuses it on a leadless Job. Live Booking can allow `dismiss` on a cancelled leadless Job while case status refuses dismiss on `resolved`. Do not fold them into one boolean so “the Owner may act,” or skip the live Booking check because the case is pending.

2. **Correct-pending skips the case-status assert.** The desk only checks `status === "pending"`. This file already lists `update_pending` on pending. Live Booking is still asserted. Leave the skip visible. Do not call the status fence from correct-pending in this pass so “every write uses the table,” or add `update_pending` on resolved so “the Owner can always edit money.”

3. **Refresh never asks this file.** A resolved or cancelled case can still refresh cards. Knowledge and the desk recommendation already say this. Do not add `refresh` to the action union so “refresh is an act,” or refuse cancelled refresh so “inspection cannot see new cards.”

4. **Mint never asks for warning overrides.** `create_and_attach` hits case status + live Booking only. The Lead does not exist yet. Do not require an empty override list on mint so “every resolve action is the same,” or run exact-match against the prepared bag so “the new Lead inherits the Job’s warnings.”

5. **Canonical `attachBookingToLead` cannot send overrides.** Begin-work still calls exact-match. Any overrideable live warning → 409. `source_conflict` also needs `source_resolution` on the desk, before this file. Do not default the required list to empty so “ingestion attach always works,” or treat a missing `overridden_warnings` as “accept all” so “the command is quieter.”

6. **Hard-block codes are known and not overrideable.** Exact-match strips them from *required* and keeps them on *provided*. Sending `lead_already_booked` as an override always 409s against a required list that cannot contain it. The desk still throws `assertLeadAttachable` first. Do not let the Owner override cancelled / already-booked so “they said so,” or drop those two codes from `ReconciliationWarning` so “only overrideable codes exist.”

7. **Unknown warning strings drop on the floor.** `theKnownWarningCodes` filters to the eight names. `["duplicate_lead", "bogus"]` matches `["duplicate_lead"]`. Leave the drop visible. Do not 409 on unknown so “typos fail closed,” or persist `bogus` so “the Owner’s list is sacred.”

8. **Extension Owner and header Owner stamp different `actor` strings.** Bearer uses `owner:<userId>` and keeps email casing. Secret+headers uses `owner:<lowercased email>`. Do not lowercase the Bearer email so “both stamps match,” or stamp Bearer as `owner:<email>` so “history is always an email.”

9. **This gate is not Registry HMAC.** No timestamp, no signature, no path canonicalization. Secret plus three owner headers is enough. Already-recommended `trustedActor.ts` is a different speaker. Do not import `requireRegistryOwnerActor` so “Owner is Owner,” or add HMAC here so “the desk is as tight as Registry.”

10. **Sheet Contains uses this speaker.** Wave B `handleSheetContains` calls the same `requireOwnerActor`. That is a live Master Sheet check, not an employee Job. Leave the leak visible. Do not move this function to `auth/` in this pass so “one Owner gate,” or refuse Sheet Contains here so “this file only knows Jobs.”

11. **`getOverrideableWarnings` is an unused desk import.** Exact-match already calls it. Do not start returning the six codes from the desk so “the UI can pre-fill,” or delete the const so “the list lives in Zod.”

12. **`applyCursorFilter` has no runtime caller.** Browse and Owner search push date+id into Mongo `$or`. The in-memory filter is tested and unused. Keep it as an alias. Do not start paging browse in memory so “the helper earns its keep,” or extract a cursor **module** so “policy is pure.”

13. **Decode rejects a non-24-hex id.** Encode will happily wrap any string. A bad encode cannot be decoded. Leave that. Do not loosen decode so “search cursors can be LID,” or make encode validate so “round-trip is total.”

14. **Pending cannot reassign.** The Owner must attach, mint, or wait until the case is dismissed/resolved with a Lead. Do not allow pending reassign so “change the guess,” or allow mint on dismissed so “the Owner can always create.”

15. **Dismissed may attach; it may not mint.** Knowledge table. Already attached: only reassign. Cancelled Booking: only reopen / dismiss. Do not allow dismiss on an attached Booking so “the case can go quiet,” or allow reassign on cancelled so “the Lead is wrong anyway.”

16. **Leave sibling modules alone.** `assertLeadAttachable`, `deriveLiveLeadWarnings`, `assertLiveBookingStateForAction`, `requireOwnerActor`, `attachLeadToEmployeeBooking`, and rematch stay where they are. This file answers “may they.”

17. **Do not treat Registry Owner, Drive owner-email, or Granot Booking-case gates as this story.** Those speakers and those cases are other files.

18. **Do not treat Book The Employee Job, rematch cron, or Book a Leadless Job as this story.** Submit never asks this file. Rematch claims later without overrides. Admin / Best Relocation Leadless may open an import-origin case; this file does not read `origin`.

## Testing

The **interface** is the test surface: `sayWhoIsSpeakingAsThisEmployeeJobOwner`, `refuseUnlessTheOwnerNamedEveryOverrideableWarningExactly`, `refuseUnlessThisCaseStatusAllowsThisAct`, `refuseUnlessThisLiveBookingAllowsThisAct`.

Today’s `reconciliationPolicy.test.ts` already names those four beats (old export names) plus unused cursor helpers. Keep the operation names. Do **not** add a test per fold (`theOverrideableWarningsOnThisLead`, `theyAreAnExtensionOwner`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

**Who is speaking**
- Extension Owner Bearer → `owner:<userId>` (already locked).
- Secret + owner headers → `owner:<lowercased email>` (already locked).
- Bare secret / Sales / Customer Service / `admin` role headers → 403 (already locked).
- Does not call Registry HMAC. Does not read Drive email.

**Exact warning overrides**
- Live `duplicate_lead` + `source_conflict`, Owner sends only `duplicate_lead` → 409 listing both (already locked).
- Live includes `lead_already_booked` + `duplicate_lead` → required is only `duplicate_lead`.
- Owner sends `lead_cancelled` as an override → 409 (cannot satisfy a required list that omitted it).
- Owner sends `duplicate_lead` plus an unknown string → matches `duplicate_lead` (unknown dropped).
- Empty live overrideable + omitted provided → pass.
- Does not attach. Does not claim.

**Case status**
- Pending allows dismiss / update_pending; refuses reopen (already locked).
- Dismissed allows attach_existing; resolved refuses attach_existing (already locked).
- Pending refuses reassign. Resolved / dismissed allow reassign.
- Mint (`create_and_attach`) only on pending.

**Live Booking**
- Cancelled refuses attach / update_pending / reassign; allows reopen / dismiss (already locked).
- Attached refuses dismiss / reopen / attach; missing Lead refuses reassign (already locked).
- Leadless allows attach and reopen (already locked).

Do not prove desk refresh-without-claim, rematch lease, or Sheet Contains here. Those are other **interfaces**. Cursor encode/decode may stay as regression aliases; do not add a new cursor suite so “policy owns paging.”

## What I would not do

- A `ReconciliationPolicyService` class with `assert` / `derive` / `normalize`.
- Thirty two-line functions that only wrap `includes`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or `auth.ts`.
- Inventing a begin / complete **seam** (this file never writes).
- Folding case status and live Booking into one boolean, or adding `refresh` to the action union.
- Letting the Owner override `lead_already_booked` / `lead_cancelled`.
- Importing Registry HMAC or Drive owner-email so “Owner is Owner.”
- Moving `deriveTrustedOwnerActor` to Wave B `auth/` so “Sheet Contains and the desk share a home.”
- Extracting encode/decode into a cursor **module**, or paging browse through `applyCursorFilter`.
- Treating Book The Employee Job, rematch cron, Registry mutations, or Granot Booking-case policy as this story.
- Opening Wave B or the next service while this checklist has unchecked modules.
