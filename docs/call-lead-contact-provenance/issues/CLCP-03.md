# CLCP-03 — CSV / preview: no live name/email

> **Contract maturity: implementation-ready.** After CLCP-01. The leftover
> Follow Up upsert must not undo snapshot-only contact. HTTP apply stays
> on the processor.

## 1. Authority and required reading

- **Pack specification:** [`../call-lead-contact-provenance-specification.md`](../call-lead-contact-provenance-specification.md)
  — §3.5, §5.5–5.6, §12.6.
- **Current Service:** [`../../knowledge/services/enrichment.md`](../../knowledge/services/enrichment.md)
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)

## 2. Objective

`syncCallLeadEnrichment` / `buildUpdate` never writes live
`phone_number` (already true) and never writes live `name` / `email`.
Prefer writing `granot_contact_snapshot` from the parsed row when that
is small and testable; otherwise skip those fields and warn. Preview
stays phone-first then `job_no`; document that Granot-only phone misses
until `job_no` fallback. Apply must not call this helper.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server` only.
- **Prerequisites:** CLCP-01 `complete`.
- Same pack branch.

## 4. Current-state evidence to verify

Observed 2026-09-04; **reverify at implementation**.

- `callLeadEnrichment.service.ts` `buildUpdate` (~577–608):
  `assignIfChanged` on `name` and `email`; no phone assign.
- `enrichment.md` § Sync: “Does not write phone or `move_date`.”
- Tests in `callLeadEnrichment.service.test.ts` assert `job_no` and
  other field updates; check whether any test requires live name/email
  write.
- HTTP apply: `automationApply.ts` / `granot-http-collector.md` — must
  still not call `syncCallLeadEnrichment`.

## 5. Locked decisions and invariants at risk

- Never write live phone. Never start writing `move_date`.
- Never overwrite a conflicting stored `job_no`.
- Do not route HTTP apply back through this helper.
- Do not teach preview to query `granot_contact_snapshot` as identity
  (optional comment only).
- Booked-jobs Path B phone fallback stays live phone; a comment is
  enough unless a test already lies.

## 6. Deliverables and exact contract

1. `buildUpdate`: remove live `name` / `email` assigns, **or** replace
   with a snapshot write that sets `differs_from_ingested` via the same
   semantic compare (`contactSemanticallyEqual`). Do not invent a second
   snapshot schema.
2. Tests: existing phone-not-written; new name/email-not-written (or
   snapshot written, live name unchanged).
3. If you skip snapshot write, add a warning string so CSV operators
   know contact stayed on the row.

## 7. Out of scope

Planner. Identity. Intake `q`. Enabling CSV as a lifecycle channel.
S3 sync script rewrite beyond what `buildUpdate` forces.

## 8. Tests

```text
src/services/enrichment/callLeadEnrichment.service.test.ts
```

## 9. Knowledge updates after this issue ships

Note for CLCP-04: `enrichment.md` must say CSV does not write live
contact fields.

## 10. Acceptance criteria

- [ ] `buildUpdate` does not set `phone_number`
- [ ] `buildUpdate` does not set live `name` / `email` (or only sets
      `granot_contact_snapshot`)
- [ ] Conflicting `job_no` still not overwritten
- [ ] HTTP apply still does not import `syncCallLeadEnrichment`
- [ ] Focused tests in §8 pass

## 11. Commands

```text
cd vantage-main-server
pnpm exec tsx --test src/services/enrichment/callLeadEnrichment.service.test.ts
pnpm typecheck
```

## 12. Risks

- Writing snapshot without `differs_from_ingested` / `captured_at`.
- Silently dropping name/email with no warning if you choose skip.
- “Fixing” preview identity by OR-ing snapshot phone (out of scope).

## 13. Rollback

Revert `buildUpdate` + tests.

## 14. Handoff list for the completion report

- Files changed
- Whether snapshot write or skip+warn was chosen
- Test command output
- Note for CLCP-04 enrichment.md
