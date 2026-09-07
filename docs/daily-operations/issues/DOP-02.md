# DOP-02 — Domain hooks (Lead, Booking, Cancellation, Lead Message)

> **Contract maturity: implementation-ready.** Session 2. After-commit
> facts for Form / Call / Booking / Cancellation / Lead Message,
> including quiet-hours deferral and zip miss. **No Granot hooks. No
> Admin UI.**

## 1. Authority and required reading

- **Pack specification:** [`../daily-operations-specification.md`](../daily-operations-specification.md)
  — §8.4–8.5, §13–15.1, §15.2, §15.6–15.8, §21.14–15.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)
- **Knowledge:** [`../../knowledge/services/lead-messaging.md`](../../knowledge/services/lead-messaging.md),
  `src/services/leadMessaging/quietHours.ts`,
  `src/services/leads/leadLocation.service.ts`
- **Glossary:** workspace-root `CONTEXT.md`

## 2. Objective

When a Form Lead, Call Lead, official Booking, official Cancellation,
or Lead Message reaches a counted outcome, Daily Operations records
exactly one fact. A 2:14 AM quiet-hours text is `text.deferred` with
resolved 8:00 AM `send_at`. A zip that does not produce a state is
`exception.zip_missing` **and** the Lead still increments.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server` only.
- **Prerequisites:** DOP-01 `complete`.
- May run in parallel with DOP-03 and DOP-04.
- No 21st.dev.
- No commit, push, deploy, or live payload read unless asked.

## 4. Current-state evidence to verify

Observed 2026-09-06; **reverify before coding.**

- `completeFormLeadIngestion` already calls
  `recordWhatTheOwnerNeedsToKnow`. Hook next to it; skip reused-lead
  early return.
- `completeCallLeadIngestion` covers Admin, Best Relocation, and
  RingCentral’s inner complete. Increment **once** here, not also in
  `ingestRingCentralQualifiedCall`.
- `resolveRequiredLocation` writes `not_found` and
  `zip_state.lookup.missing`. Call optional lookup may leave state blank.
- Quiet hours: `LEAD_SMS_QUIET_HOUR_END = 7`,
  `LEAD_SMS_DEFERRED_SEND_HOUR = 8`, gated by
  `LEAD_MESSAGING_QUIET_HOURS_ENABLED`. The Lead Message row has **no**
  `deferred` status and **no** `send_at` field. Copy `sendAt` from
  `buildLeadMessageTwilioSendInput` onto the Daily Operations Event
  `card`. Infer still-held later via `provider_status: "scheduled"`.
- `SUCCESSFUL_LEAD_MESSAGE_STATUSES` is `accepted` | `sent` | `delivered`.
- `finalizeBookedLeadCreateAfterCommit` skip `kind === "duplicate"`.
- `runExistingCreateCancellation` finalize has cancellation / booking /
  job in `pending`. Live API does not emit `cancellation.created` today.
- Do **not** hook `applyBestRelocationPlan` or `persistLeadMessageIntent`.

## 5. Locked decisions and invariants at risk

- After-commit only. Writer never throws into the domain path.
- Replays, receipt reuse, duplicate booking submissions do not count.
- Headline Leads exclude duplicates and Unmatched Call Leads.
- Bookings / Cancellations bind on write time, not `book_date` /
  `cancel_date`.
- `text.deferred` does not increment `messages.successful`.
- Zip miss does not exclude the Lead from `leads.total`.
- Best Relocation apply is not a hook.

## 6. Deliverables and exact contract

1. Form complete → `form_lead.created` / `.duplicate` + card (name,
   last4, origin, company, zips/states). Zip miss → second event
   `exception.zip_missing`.
2. Call complete → created / duplicate / unmatched. Same zip-miss rule
   when a zip is present and state is missing. Adoption conflict →
   `exception.adoption_conflict` from the ingest recorder.
3. Lead Message: deferred vs sent vs skipped vs failed (spec §8.4,
   §15.6). Dedupe keys `message:<id>:deferred` and `:successful`.
4. Booking finalize paths in spec §15.7 (skip duplicate / replay).
5. Cancellation finalize paths in spec §15.8.
6. CRM fail → `exception.crm_failed` from the existing complete / CRM
   seam (optional if the fail path is not reachable in the same
   sitting — record in PROGRESS if deferred to a follow-up inside
   this issue, do not silently skip).
7. Tests for each hook: increment once, skip replay / reuse /
   duplicate booking, quiet-hours 2:14 AM vs 7:00 AM, zip miss still
   counts the Lead.

## 7. Out of scope

- Granot capture / processor / intake (DOP-03).
- HTTP / SSE / cron (DOP-04 / DOP-05).
- Admin UI (DOP-06 / DOP-07).
- Sheet Sync drain hook (optional v1; may leave a TODO in kinds).

## 8. Tests

Spec §19 quiet-hours, zip-miss, and Form/Call integration rows.
Existing form-lead / call-lead / booking / messaging tests stay green.

## 9. Knowledge updates after this issue ships

None required. DOP-08 owns pointers.

## 10. Acceptance criteria

- [x] Form create increments `leads.form` + origin + company once.
      Evidence: `recordDomainFacts.test.ts` captured `metric_touches`.
- [x] Duplicate Form increments `leads.duplicate_form` only.
      Evidence: same file, kind `form_lead.duplicate`.
- [x] Call unmatched increments `leads.unmatched_call` only.
      Evidence: same file, kind `call_lead.unmatched`.
- [x] Quiet hours at 02:14 ET → `text.deferred` + `card.text.send_at`
      8:00 AM ET; no `messages.successful`.
      Evidence: `send_at` `2026-01-15T13:00:00.000Z`; touches
      `messages.deferred` only.
- [x] 07:00 ET send → `text.sent` only (not deferred).
      Evidence: same file, kinds `["text.sent"]`.
- [x] First `sent`/`delivered` after deferred → `text.sent` once.
      Evidence: both callbacks use `message:<id>:successful`.
- [x] Zip `33101` + state `not_found` → Lead counts **and**
      `exception.zip_missing`.
      Evidence: `form_lead.created` includes `leads.total` plus zip-miss
      fingerprint `exception:zip_missing:FormLead:<leadId>`.
- [x] Replay / reused WordPress lead / duplicate booking submission
      do not call the writer (or the writer no-ops via dedupe).
      Evidence: reused helper leaves sink empty; duplicate booking
      finalize returns before the writer; canonical finalize skipped
      when `replayed`.
- [x] `applyBestRelocationPlan` is not a hook site.
      Evidence: source-search in `recordDomainFacts.test.ts`.
- [x] Focused tests + typecheck.
      Evidence: 121 pass; `pnpm typecheck` exit 0. See
      `reports/DOP-02-completion.md`.

## 11. Commands

```bash
cd vantage-main-server && pnpm exec tsx --test src/services/dailyOperations/ src/services/leads/formLead.service.test.ts src/services/leads/callLead.service.test.ts src/services/leadMessaging/leadMessaging.service.test.ts src/services/leadMessaging/quietHours.test.ts
```

Adjust to the test files you actually touch. Paste output.

## 12. Risks

- Double increment from RingCentral ingest + complete.
- Counting `accepted`+scheduled as `text.sent`.
- Hooking `persistLeadMessageIntent` inside the transaction.
- Forgetting Unmatched Call Lead exclusion.
- Hooking Best Relocation apply.

## 13. Rollback

Remove the `recordDailyOperationsFact` calls. Domain writes remain.

## 14. Handoff list for the completion report

- Hook sites and what `card` each sends.
- Quiet-hours examples (ISO `send_at`).
- Zip-miss fingerprint.
- What you did not hook (Granot, Sheet Sync).

**Unblocks:** DOP-08 (with DOP-03 + DOP-07). Feeds DOP-04 rebuild
expectations.
