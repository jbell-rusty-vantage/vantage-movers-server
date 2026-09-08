# CLCP-03 — Shared HTTP / extension preview + CSV

> **Contract maturity: implementation-ready.** After CLCP-01. Preview and
> the leftover Follow Up helper must not undo snapshot-only contact.
> HTTP Automation and the extension Call Leads apply stay on the same
> processor door.

## 1. Authority and required reading

- **Pack specification:** [`../call-lead-contact-provenance-specification.md`](../call-lead-contact-provenance-specification.md)
  — §3.4–3.5, §5.5–5.6, §8, §12.6–12.7.
- **Current Services:** [`../../knowledge/services/enrichment.md`](../../knowledge/services/enrichment.md),
  [`../../knowledge/granot-lifecycle/extension-apply.md`](../../knowledge/granot-lifecycle/extension-apply.md),
  [`../../knowledge/granot-lifecycle/automation-apply.md`](../../knowledge/granot-lifecycle/automation-apply.md)
- **Extension map:** `granot_sync_extensions_and_services/.cursor/rules/granot-call-leads-workflow.mdc`
  and `granot-extension-architecture.mdc`
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)

## 2. Objective

One Call contact rule for webhook, HTTP Automation, and extension apply.
Preview (`previewCallLeadEnrichment` / booked preview) is Job-first when
the row has a Job Number, treats Granot mobile as **not** identity, and
marks snapshot-only contact diffs `updateable` so HTTP `syncable` still
offers them. `buildUpdate` never writes live phone/name/email. Apply
does not call `syncCallLeadEnrichment`.

## 3. Repository, branch, and prerequisites

- **Repositories:** `vantage-main-server` (matcher, CSV, HTTP
  `syncable`). `granot_sync_extensions_and_services` on `main` at
  package `0.2.8` (apply stays `{ items }` / raw statement; popup and
  cycle-history copy must not promise live name/phone writes).
- **Prerequisites:** CLCP-01 `complete`.
- Same pack branch on the server. Do not open an extra extension branch.

## 4. Current-state evidence to verify

Observed 2026-09-04; **reverify at implementation**.

- `callLeadEnrichment.service.ts` `findBestCallLeadMatch` (~470–523):
  phone first on the Granot row phone, then `job_no`.
- `buildUpdate` (~577–608): `assignIfChanged` on `name` and `email`; no
  phone assign.
- `planCallWorkflow` in `runWorkflow.ts` (~468–487): `syncable` when
  `preview.status === "updateable"` or a receiver-agent bind.
- `automationApply.ts` / `extensionApply.ts`: capture →
  `claimAndProcessOrPoll`. Must still not import
  `syncCallLeadEnrichment`.
- Extension `workflows/call-leads/apply.ts`: `lead_snapshot_apply` /
  `booking_action_apply` via `applyQueuedItems`.
- Extension `api/callLeads.ts` POSTs those items to the existing
  `/enrichment/sync` and `/booked-reconciliation/sync` URLs.
- Booked Path B: Job first; phone fallback is live operational phone
  ([`booked-call-lead-reconciliation.md`](../../knowledge/services/booked-call-lead-reconciliation.md)).

## 5. Locked decisions and invariants at risk

- Never write live phone/name/email from CSV or preview classification.
- Never start writing `move_date`.
- Never overwrite a conflicting stored `job_no`.
- Never route HTTP or extension **apply** through
  `syncCallLeadEnrichment`.
- Never query `granot_contact_snapshot` as preview **identity**.
- Job first when the row has a Job Number. Phone only for first bind,
  against operational + ingested phone.
- Contact-only Granot card diff stays `updateable` (HTTP must still
  offer the row).
- Extension apply gates stay `updateable` / `unchanged` / `updated`.
- Owner copy: **Called** / **Granot** / **Changed in Granot**. Do not
  say live name or phone will update.

## 6. Deliverables and exact contract

1. `findBestCallLeadMatch`: Job first when `parsed.job_no` is present.
   Phone rung only when Job is missing or Job misses. Phone still uses
   operational + ingested equality, not the snapshot.
2. Prove: row Job on Lead A + Granot phone = Lead B’s ANI → preview
   selects A (`job_no_only` or `phone_and_job_no` on A), not B.
3. `buildUpdate`: remove live `name` / `email` assigns, **or** replace
   with a `granot_contact_snapshot` write that stamps
   `differs_from_ingested` via `contactSemanticallyEqual`. Do not invent
   a second snapshot schema.
4. Preview `updateable` includes snapshot contact coalesce (compare
   incoming Granot contact to stored `granot_contact_snapshot`, not to
   live name/email). HTTP `syncable` stays true for that case.
5. Tests: existing phone-not-written; new name/email-not-written (or
   snapshot written, live name unchanged); Job-first; contact-only
   snapshot diff is `updateable`.
6. If CSV skips snapshot write, add a warning that contact stayed
   observation-only until lifecycle apply.
7. Extension: keep `apply.ts` on raw-statement `{ items }`. Change
   popup / cycle-history copy only if it still claims live contact
   updates. Do not add a second write client.

## 7. Out of scope

Planner. Identity. Intake / Admin `q` (CLCP-05). Enabling CSV as a
lifecycle channel. Enabling apply flags. S3 sync script rewrite beyond
what `buildUpdate` forces.

## 8. Tests

```text
src/services/enrichment/callLeadEnrichment.service.test.ts
```

Add a booked-reconciliation preview test only if Path B phone fallback
would now lie. Extension: existing
`src/test/lifecycle-apply.test.ts` / `call-leads-payloads.test.ts` still
prove apply stays `{ items }` / `lead_snapshot_apply`.

## 9. Knowledge updates after this issue ships

Note for CLCP-04: `enrichment.md` must say CSV does not write live
contact; preview is Job-first; apply still processor.
`extension-apply.md` / `automation-apply.md` get one sentence: same
snapshot contact rule.

## 10. Acceptance criteria

- [x] `buildUpdate` does not set `phone_number`
- [x] `buildUpdate` does not set live `name` / `email` (or only sets
      `granot_contact_snapshot`)
- [x] Conflicting `job_no` still not overwritten
- [x] Preview matches Job first when the row has a Job Number
- [x] Granot phone = other Lead’s ANI does not steal a Job-bearing Lead
- [x] Contact-only snapshot diff is `updateable` (HTTP `syncable`)
- [x] Preview phone rung does not query `granot_contact_snapshot`
- [x] `automationApply.ts` and `extensionApply.ts` still do not import
      `syncCallLeadEnrichment`
- [x] Extension apply still POSTs `{ items }` with
      `lead_snapshot_apply` / `booking_action_apply`
- [x] Extension copy does not promise live name/phone writes
- [x] Focused tests in §8 pass

## 11. Commands

```text
cd vantage-main-server
pnpm exec tsx --test src/services/enrichment/callLeadEnrichment.service.test.ts
pnpm typecheck
```

In `granot_sync_extensions_and_services` if copy or apply tests change:

```text
pnpm exec vitest run src/test/lifecycle-apply.test.ts src/test/call-leads-payloads.test.ts
```

## 12. Risks

- Writing snapshot without `differs_from_ingested` / `captured_at`.
- Silently dropping name/email with no warning if you choose skip.
- Teaching preview to OR snapshot phone as identity (forbidden).
- Leaving phone-first “because apply rematches” — Owner
  `expected_target` then false-conflicts.
- Routing HTTP apply back through `syncCallLeadEnrichment`.

## 13. Rollback

Revert matcher + `buildUpdate` + tests + any extension copy. Apply
routes stay on capture.

## 14. Handoff list for the completion report

- Files changed (server and extension)
- Whether snapshot write or skip+warn was chosen for CSV
- Test command output
- Proof apply still does not import `syncCallLeadEnrichment`
- Note for CLCP-04 enrichment / extension-apply / automation-apply
