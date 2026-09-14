# RRF-02 — Admin 409 copy

> **Contract maturity: implementation-ready.** Session 2. Owner 409
> sentences must name the actual code. **No server helper change.**

## 1. Authority and required reading

- **Pack specification:** [`../referral-review-release-first-specification.md`](../referral-review-release-first-specification.md)
  — §6, §8.3, §9 AC-RRF-07.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)
- **Glossary:** workspace-root `CONTEXT.md`

## 2. Objective

When No Action, Update, or Confirm Cancellation returns 409, the
Owner sees a sentence that matches `GRANOT_CASE_REVISION_CONFLICT`,
`GRANOT_IDENTITY_CONFLICT`, or `DOMAIN_REVISION_CONFLICT`. Identity
must not be labeled “the case revision changed.”

Unsent reason / form fields stay. Detail refetches. No auto-resubmit.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-admin` only.
- **Branch:** current admin desk branch. See the protocol.
- **Prerequisites:** RRF-01 `complete` preferred so the identity 409
  is no longer the live deadlock. Copy can ship second.
- No 21st.dev in this issue.
- No commit, push, or deploy unless asked.

## 4. Current-state evidence to verify

Observed 2026-09-14; **reverify before coding.**

- `no-action-form.tsx` maps any `status === 409` to “The case
  revision changed (`${error.code}`)…”
- `booking-update-form.tsx` and `cancellation-command-form.tsx` use
  a broader “case, Booking revision, or identity changed” bucket.
- No shared helper in `intake-copy.ts` for these codes today.

## 5. Locked decisions and invariants at risk

- Admin renders server codes. It does not decide policy.
- Refresh on 409 stays. Do not auto-retry submit.
- Do not invent new HTTP codes.

## 6. Deliverables and exact contract

1. Add a copy helper in
   `vantage-admin/components/intakes/intake-copy.ts` (spec §6 table).
2. Wire No Action, Update, and booking Confirm Cancellation forms.
3. Unit tests: identity ≠ revision sentence; revision code may use
   the revision sentence; unsent fields are a form-behavior check
   if a test already exists — do not regress preserve-on-409.

## 7. Out of scope

- Server helper (RRF-01).
- Knowledge (RRF-03).
- Discrepancy 409 copy unless you already touch a shared helper —
  record leftover in PROGRESS if you notice it.
- Create Referral / confirm-booking form copy unless the same helper
  is a one-line swap.

## 8. Tests

Spec §8.3. Prefer a pure function test on the copy helper.

## 9. Knowledge updates after this issue ships

None required. RRF-03 may mention Owner 409 sentences if already
editing the pointer.

## 10. Acceptance criteria

- [x] `GRANOT_IDENTITY_CONFLICT` copy does not say the case revision
      changed.
- [x] `GRANOT_CASE_REVISION_CONFLICT` still explains revision /
      latest-action posture.
- [x] `DOMAIN_REVISION_CONFLICT` names the Booking revision.
- [x] 409 still refreshes and does not auto-submit.
- [x] Admin `pnpm test` / typecheck / lint for touched files.

## 11. Commands

```bash
cd vantage-admin && pnpm test && pnpm typecheck && pnpm lint
```

Scope to the new/changed test file if the full suite is huge. Paste
output in the completion report.

## 12. Risks

- Copy that teaches the Owner a new synonym for No Action.
- Changing submit/idempotency behavior while fixing the sentence.

## 13. Rollback

Revert the copy helper and form wiring.

## 14. Handoff list for the completion report

- Helper name and form call sites.
- Test output.
- What you did not do (server, production case).
