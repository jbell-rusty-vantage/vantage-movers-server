# Pick The Unique Lead Or Say Why This Job Stays Pending — Five Enabled Rules After Identity, Overflow, And Stronger Blocks — Never Claim, Never Book, Never Search Again — operational story

- Status: recommended
- Service: `employeeBookings` (Wave A, in-progress)
- Pass: 3 of this service — `leadMatchEvaluator.ts`
- Remaining in this service: `bookingLeadReconciliation.service.ts`, `bookingLeadAttachment.service.ts`, `reconciliationPolicy.ts`, `reconciliationRematch.service.ts`, `migrationPreflight.ts`, `migrationApplySafety.ts`
- Target: `src/services/employeeBookings/leadMatchEvaluator.ts`
- Knowledge: [`docs/knowledge/services/employee-bookings.md`](../../../docs/knowledge/services/employee-bookings.md) (preferred model follows the submitted channel; overflow never auto-links; first enabled winner; opposite-channel-only stays `channel_conflict`; `none` disables auto-link). This checkout’s `CONTEXT.md` defines `employee booking submission`, `booking lead reconciliation case`, `employee booking origin`, and `matching unavailable` — link those terms; do not invent a second glossary. `matching unavailable` is a thrown-query catch in submit / rematch, not a reason this file returns. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: `submitEmployeeBooking.service.ts` (initial match; claim lives after this return), `reconciliationRematch.service.ts` (delayed retry; attach lives after this return), `bookingLeadReconciliation.service.ts` (`refreshBookingLeadCandidates`, `updatePendingEmployeeBooking`, `reopenBookingLeadReconciliation` — same decision; those three **record** a would-be link and do not claim). Tests: `leadMatchEvaluator.test.ts` (LID link, overflow, opposite-channel, `none`, contact-triple after LID miss, name contradiction, LID-vs-phone, same-company granularity). Barrel does not re-export this file.
- Seams callers need: `linked` (which Lead, which rule) vs `pending` (which reason); the same candidate cards echoed back for the case; overflow as a third argument so a truncated page cannot prove uniqueness
- Split later (only if the file outgrows one sitting): keep one file — this is already one sitting. Do not split into `identity.ts` / `blocked.ts` / `rules.ts`. Assemble, claim, Owner attach, rematch cron, and warning overrides live in siblings.

`evaluateEmployeeBookingMatch` is executor mechanics. The owner question is: *We already have the Form Lead and Call Lead cards for this employee Job. Is there one unique source-compatible Lead we can auto-link, or must this Job stay pending for the Owner? Say which Lead and which rule, or say why. Do not search again. Do not claim. Do not book. Do not invent `matching unavailable`.*

## What this file actually does

Five operations of one “pick the unique Lead or leave it pending” story, not “a scoring helper,” and not Book The Employee Job:

1. **Refuse when the cards disagree about who this Job is** — LID or Job Number already named a Lead, but phone / email / name named a different one; two primary identities; email or name evidence disjoint from phone; or a typed name contradicts a Form card. Pending `identity_conflict`.
2. **Refuse when uniqueness is unproven** — the finder said `hasOverflow`. Pending `multiple_matches` before any positive rule, including a unique LID sitting in the kept 25.
3. **Refuse when a stronger block already exists** — opposite-channel-only hits (`channel_conflict`); an exact LID / Job card that is source-conflicted, unassigned, same-company-with-a-site, duplicate, booked, cancelled, or Call `created_on_unmatched` (`no_match`); two eligible exact-identity cards (`multiple_matches`).
4. **Apply the enabled auto-match rules in listed order** — first rule that finds exactly one eligible, source-compatible winner returns `linked` + that rule. Two winners on that rule → pending `multiple_matches` and stop. Zero winners → the next enabled rule.
5. **Name why this Job still stays pending** — after every enabled rule declined: opposite-channel leftovers, a preferred-model source conflict, several preferred eligible cards, or `no_match`. Empty enabled rules (`none`) land here.

Finding the cards, claiming the Lead, opening the Owner case, Owner any-known-contact search, and warning-override attach are other files. This file never writes a Booking, never claims, never POSTs Granot, never drains Sheet Sync, and never throws `matching unavailable`.

## Organization

Keep one file. This is the screenplay for “which Lead is this employee Job, or why the Owner must look.” Candidate assemble, source-fit score, claim, rematch, and Owner typed search already live in deeper **modules**. Do not pull those in. Do not invent an `EmployeeBookingMatchService` class. Do not invent a begin / complete Domain Command **seam** — this file is a pure decision the write already started.

If it later outgrows one sitting, the split is still this decision vs Owner attach, never CRUD and never one file per rule.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `evaluateEmployeeBookingMatch` | `pickTheUniqueLeadOrSayWhyThisJobStaysPending` | submit and rematch attach after a `linked`; Owner refresh / update-pending / reopen only record the same decision |
| `EmployeeBookingMatchOutcome` | `EmployeeJobMatchDecision` | `linked` (Lead + rule + `high_confidence`) vs `pending` (reason) — leave the type on sibling `types.ts` |

Keep the old name as a one-line alias until submit, rematch, and Owner reconciliation migrate. Do not make callers learn `evaluate` / `Match` as the domain language. Do not export `evaluatePositiveRule`, `linkSingleEligible`, `detectIdentityConflict`, `detectStrongestBlockedReason`, `detectFallbackReason`, `isSourceCompatibleForAutoAttach`, or `isCandidateEligibleForAutoAttach`.

The function is `async` and does no I/O. It only reads `getEmployeeBookingMatchingConfig()`. Keep the Promise **seam** as the alias so today’s `await` callers do not change in this pass. Do not add a repository so “config looks fetched.”

**No class for the workflow.** The one type that earns a name is already on sibling `types.ts`:

```ts
type EmployeeJobMatchDecision =
  | {
      kind: "linked"
      leadId: string
      leadModel: "FormLead" | "CallLead"
      rule: EmployeeBookingAutoMatchRule
      candidates: EvaluatedLeadCandidate[]
      reason: "high_confidence"
    }
  | {
      kind: "pending"
      reason: BookingLeadReconciliationReason
      candidates: EvaluatedLeadCandidate[]
    }
```

That is the handoff from “here are the cards” to “claim this Lead” or “open / keep the Owner case.” Do not move `PreparedEmployeeBookingSubmission` or `EvaluatedLeadCandidate` here. Do not add `matching_unavailable` to the linked/pending union so “every submit reason lives on the matcher.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// leadMatchEvaluator.ts
// We already have the Form Lead and Call Lead cards for this employee Job.
// Is there one unique source-compatible Lead we can auto-link,
// or must this Job stay pending for the Owner?
// Say which Lead and which rule, or say why.
// Do not search again. Do not claim. Do not book.

// ── 1. Refuse when the cards disagree about who this Job is ─

function theCardsDisagreeAboutWhoThisJobIs(prepared, cards)
  // LID / Job Number are primary. Once either names a Lead,
  // every phone / email / name hit must stay on that same Lead.
  // Two primary ids → conflict.
  // Without a primary: email or name disjoint from phone → conflict.
  // Typed name + any Form `name_contradiction` warning → conflict.

// ── 2. Refuse when uniqueness is unproven ─────────────────

function uniquenessIsUnproven(hasOverflow)
  // finder fetched a 26th row on any lookup — do not treat the kept 25 as unique

// ── 3. Refuse when a stronger block already exists ────────

function aStrongerBlockAlreadyExists(prepared, cards, preferredModel)
  // preferred model = form channel → FormLead, call channel → CallLead
  // no preferred cards and only opposite-channel cards → channel_conflict
  // exact LID / Job cards only:
  //   source conflict → source_conflict
  //   duplicate / booked / cancelled → that reason
  //   Call created_on_unmatched → no_match
  //   two eligible exact-identity cards → multiple_matches
  //   unassigned, or same_company with a stored site → source_conflict

// ── 4. Apply the enabled auto-match rules in listed order ─

export async function pickTheUniqueLeadOrSayWhyThisJobStaysPending(
  prepared,
  cards,
  hasOverflow = false,
)
  // config.enabledRules — empty when EMPLOYEE_BOOKING_AUTO_MATCH_RULES=none
  // identity → overflow → stronger block → first enabled winner → leftover reason

function tryThisEnabledRule(rule, prepared, cards, preferredModel)
  // form_lid_exact: Form channel + typed LID + unique Form lid-method, source-compatible
  // call_job_no_exact: Call channel + unique Call job_no-method, source-compatible
  // form_contact_triple_exact: Form channel + typed email + typed name
  //   + no Form lid-method card exists + unique phone+email+name at exact_granularity
  // form_email_phone_exact: Form channel + typed email + no Form lid-method card
  //   + unique phone+email at exact_granularity + no name_contradiction on that card
  // channel_phone_exact: unique preferred-model phone at exact_granularity
  //     (no LID-card skip)

function linkWhenExactlyOneCardCanBeClaimed(rule, matchingCards, allCards)
  // eligible = eligibility eligible AND not created_on_unmatched
  // one → linked + that rule + reason high_confidence + echo allCards
  // many → pending multiple_matches
  // none → null (try the next rule)

function thisCardFitsTheBookingSourceWellEnoughToAutoLink(card)
  // exact_granularity, or same_company with no stored source_granularity_key

// ── 5. Name why this Job still stays pending ──────────────

function nameWhyThisJobStillStaysPending(cards, preferredModel)
  // no preferred cards but some opposite → channel_conflict
  // any preferred source conflict → source_conflict
  // several preferred eligible → multiple_matches
  // else no_match
```

Read the path out loud: *If the cards disagree about who this Job is, leave it pending. If any lookup overflowed, uniqueness is unproven — leave it pending, even when a unique LID is in the kept page. If a stronger block already exists — wrong channel, bad source on an exact identity, duplicate, booked, cancelled, unmatched Call, or two exact identities — leave it pending. Otherwise walk the enabled rules in order. The first rule that finds exactly one eligible source-compatible Lead is the winner. Two winners on that rule, or no winner after every rule, stay pending. Hand the decision back. Do not claim. Do not book.*

That is the operation. `evaluateEmployeeBookingMatch` is not.

Submit and rematch say the next sentence: claim when `linked`, else open or keep the Owner case. Owner refresh, update-pending, and reopen say a different next sentence: write the attempt and the cards; do **not** claim just because this file returned `linked`. This file does not know which caller it is.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Overflow kills every rule, including LID.** `hasOverflow` is checked after identity and before the blocked walk. A unique Form LID in the kept 25 still returns `multiple_matches` when a phone (or name) page had a 26th row. Knowledge already says this. Do not skip overflow so “LID is stronger,” or treat `candidates.length === 25` as overflow without the finder flag.

2. **Identity runs before overflow.** LID + phone naming two Leads is `identity_conflict` even when the phone page also overflowed. The Owner sees identity, not overflow. Do not flip the order so “overflow is always first,” or collapse both into `multiple_matches` so “the case has one reason.”

3. **A Form LID *card* blocks contact rules, not a typed LID.** `formLidProducedCandidate` is `some(FormLead && methods includes lid)`. Submit can type a LID, miss every Form LID row, and still win on phone+email+name — tests lock that. A leftover LID card — even booked, cancelled, duplicate, or opposite-source — skips `form_contact_triple_exact` and `form_email_phone_exact`. The blocked walk should have already pending’d that ineligible exact identity. If it did not (for example the LID card is opposite-channel and preferred cards exist), contact rules stay skipped. Do not ungate so “fallback contact can still win beside a LID card.”

4. **`channel_phone_exact` does not skip on a LID card.** After LID and contact rules decline, phone at exact granularity can still link the preferred model. That is how a Form Job with a LID miss reaches phone. Do not add the LID skip to phone so “every form rule agrees.”

5. **Same-company without a stored site may auto-link; with a site it may not.** `isSourceCompatibleForAutoAttach` allows `same_company` only when `snapshot.source_granularity_key` is missing (legacy). The blocked walk treats exact-identity `same_company` *with* a key as `source_conflict` before rules run. Tests lock the with-key case. Do not allow every `same_company` so “company match is enough,” or pending every `same_company` so “legacy blanks also wait.”

6. **Unassigned exact identity is stored as `source_conflict`, not `source_unassigned`.** The card warning can be `source_unassigned`. The matcher reason is `source_conflict`. Rematch and Owner filters key on the reason. Do not rename the stored reason so “the warning and the case agree.”

7. **Call `created_on_unmatched` on an exact identity is `no_match`.** Same stored reason submit uses at claim time. The card warning stays `created_on_unmatched` (overrideable later). Do not store `created_on_unmatched` as the case reason so “the field matches.”

8. **Eligibility order on exact identity is duplicate, then booked, then cancelled.** The finder stamps cancelled over booked over duplicate. The matcher’s first `ineligible` walk uses `find`, so document order wins, then the `if` ladder prefers duplicate. Two exact-identity cards (one duplicate, one cancelled) can pending `duplicate_lead` because that card appeared first. Do not “fix” the walk so cancelled always wins in this pass.

9. **This file never returns `matching unavailable`.** Submit / rematch catch a thrown query and stamp that reason themselves. The leftover-reason helper cannot emit it. Rematch still maps `evaluated.reason === "matching_unavailable"` to attempt `error`. That branch is dead for this **interface**. Do not throw on overflow so “errors look honest,” or return `matching_unavailable` on empty cards so “the cron has something to do.”

10. **`none` still decides, and the decision is `no_match`.** Empty `enabledRules` skips the rule loop. A unique eligible LID still pending `no_match` (unless identity / overflow / a stronger block already won). Submit still books. Do not return `linked` when rules are empty so “the Lead is obviously unique,” or skip the blocked walk when rules are empty so “none means no reasons.”

11. **Linked reason is always `high_confidence`.** Phone-only `channel_phone_exact` stores the same reason as LID. The finder’s `confidence` field is never read. Do not key the winner on `confidence === "high"` so “the names agree,” or delete `reason` on `linked` so “the rule is enough.”

12. **`form_email_phone_exact`’s `name_contradiction` filter is mostly dead.** Identity already pending’s when a name was typed and *any* card has that warning. The finder only stamps the warning when a name was typed. So the rule-level filter cannot save a clean phone+email card beside a contradicted sibling, and it cannot fire when no name was typed. Leave both checks. Do not drop identity so “email+phone can still win,” or drop the rule filter so “identity already covered it.”

13. **Household phone is not a conflict until email or name is disjoint.** Several phone cards plus an email card on one of those same Leads is allowed. Email-only cards with no shared phone id are `identity_conflict`. Do not treat every multi-phone set as `multiple_matches` before rules, or treat disjoint email as `no_match`.

14. **Opposite-channel-only is decided twice.** The blocked walk returns `channel_conflict` when preferred is empty and opposite is not. The leftover helper repeats that. After a preferred card exists, an opposite Call Job hit is echoed on the case and does not, by itself, block a Form LID winner. Do not skip Call Job cards on a form submit so “preferred is the only collection” — the finder already loads them so identity and channel can see them.

15. **Owner refresh / update-pending / reopen do not claim.** They call this file, store `latest_candidates` and a match attempt, and only overwrite `reason` when the decision is `pending`. A `linked` return does not attach. Rematch and submit do. Do not pull `claimAvailableLeadForBooking` into this file so “linked always attaches.”

16. **The function is `async` for no I/O.** Config is env. Keep the alias Promise. Do not add `await` inside so “it looks real,” or make callers sync in this pass.

17. **`detectFallbackReason` ignores the submission.** Preferred model is already computed. Do not start reading LID / email again in the leftover helper so “fallback can re-run a rule.”

18. **Leave sibling modules alone.** `queryEmployeeBookingCandidates`, `classifyLeadSourceCompatibility`, `claimAvailableLeadForBooking`, `getEmployeeBookingMatchingConfig`, and Owner `searchBookingLeadCandidates` stay where they are. This file orchestrates the decision.

19. **Do not treat Book This Lead, Book a Leadless Job, or Granot Owner Confirm as this story.** Those paths start from a known Lead or a Granot case. This path starts from cards the employee-booking finder already built.

20. **Do not silently add a command `begin` / `complete`.** There is no Domain Command **adapter** here. A second **adapter** that does not exist is not a **seam**.

## Testing

The **interface** is the test surface: `pickTheUniqueLeadOrSayWhyThisJobStaysPending` (today’s `evaluateEmployeeBookingMatch`).

Today’s `leadMatchEvaluator.test.ts` stubs no Mongo. It proves eight facts: unique Form LID links; overflow pending `multiple_matches` over that LID; opposite-channel-only is `channel_conflict`; `none` is `no_match` despite a unique LID; contact-triple can link after a typed LID miss; typed name plus `name_contradiction` is `identity_conflict`; LID and phone on two Leads is `identity_conflict`; same-company with a stored site is `source_conflict`. That is the identity / overflow **seam**. It is not enough for the five rules or the blocked walk.

Add tests that name the operation. Do **not** add a test per helper (`theCardsDisagreeAboutWhoThisJobIs`, `thisCardFitsTheBookingSourceWellEnoughToAutoLink`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

**Refuse first**
- Overflow + unique Form LID → `pending` / `multiple_matches` (already locked).
- LID and phone on two Leads → `identity_conflict` even when overflow is also true (identity wins the reason).
- Typed name + any card `name_contradiction` → `identity_conflict` before `channel_phone_exact`.
- Email ids disjoint from phone ids, no LID → `identity_conflict`.
- Several phone cards plus email on one of those same Leads is not, by itself, identity conflict.

**Stronger block**
- Opposite-channel-only → `channel_conflict` (already locked).
- Exact LID / Job `eligibility: duplicate | booked | cancelled` → that pending reason; no link.
- Exact Call Job with `created_on_unmatched` → `no_match`.
- Exact LID `sourceCompatibility: unassigned` → `source_conflict` (not `source_unassigned`).
- Exact LID `same_company` with `source_granularity_key` → `source_conflict` (already locked).
- Two eligible exact LID / Job cards → `multiple_matches` before the rule loop.
- Preferred cards exist; an extra opposite-channel Job card does not, by itself, block a unique Form LID link.

**Enabled rules**
- Unique Form LID, source-compatible → `linked` / `form_lid_exact` / `high_confidence` (already locked).
- Call channel + unique Call `job_no` → `linked` / `call_job_no_exact`.
- Form channel, LID miss, unique phone+email+name at `exact_granularity` → `linked` / `form_contact_triple_exact` (already locked).
- Form channel, typed email, no LID card, unique phone+email at `exact_granularity` → `linked` / `form_email_phone_exact`.
- Unique preferred-model phone at `exact_granularity` when earlier rules declined → `linked` / `channel_phone_exact`.
- Two eligible cards for the current rule → `pending` / `multiple_matches`; later rules do not run.
- `same_company` with no stored `source_granularity_key` may still link on LID (legacy blank site).
- `EMPLOYEE_BOOKING_AUTO_MATCH_RULES=none` → `pending` / `no_match` despite a unique LID (already locked).
- Empty candidate list → `pending` / `no_match`.
- This **interface** never returns `matching_unavailable`.

Do not prove claim, Sheet Sync, rematch cron, Owner typed search, or warning-override attach here. Those are sibling **interfaces**. Do not assert that Owner refresh attaches on `linked` — it does not.

## What I would not do

- An `EmployeeBookingMatchService` class with `evaluate` / `score` / `decide`.
- Thirty two-line functions that only wrap an existing `filter`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or a `rules/` folder with one file per auto-match rule.
- Breaking a caller’s before-commit **seam**. This decision stays inside the write the caller already opened; it does not finalize Sheet Sync or record owner events.
- Inventing a Domain Command **seam** that has only one **adapter**.
- Treating candidate assemble, claim, rematch cron, Owner attach, or Owner any-known-contact search as this story.
- Searching again so “the matcher can fetch a 26th row.”
- Importing the Granot prefix-aware Job filter so “every Job rule agrees.”
- Skipping overflow, or ungating contact rules beside a LID card, so a unique LID / phone can still auto-link.
- Returning `matching_unavailable` from this file, or throwing on overflow.
- Pulling `claimAvailableLeadForBooking` in so every `linked` attaches, including Owner refresh.
- Opening Wave B or the next service while this checklist has unchecked modules.
