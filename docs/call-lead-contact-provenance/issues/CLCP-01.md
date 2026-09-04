# CLCP-01 — Planner + synchronize: snapshot-only Call contact

> **Contract maturity: implementation-ready.** Session 1. Stop Granot
> synchronize from overwriting live Call phone/name/email. Write
> `granot_contact_snapshot` only. **No identity change. No CSV change.
> No flag flip.**

## 1. Authority and required reading

- **Pack specification:** [`../call-lead-contact-provenance-specification.md`](../call-lead-contact-provenance-specification.md)
  — §0, §1, §3.2, §4.1–4.3, §5.1–5.4, §10, §12.1. Wins on write paths.
- **Current Services:** [`../../knowledge/granot-lifecycle/desired-state.md`](../../knowledge/granot-lifecycle/desired-state.md),
  [`../../knowledge/services/form-lead.md`](../../knowledge/services/form-lead.md)
  (WordPress snapshot pattern to copy).
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)
- **Glossary:** workspace-root `CONTEXT.md`

## 2. Objective

`planQualifiedContact` treats every Call (and every non-WordPress Form)
like WordPress Form: qualified Granot contact plans
`granot_contact_snapshot` only. `synchronizeLeadFromGranot` persists that
card and leaves live `phone_number` / `normalized_phone_number` / `name`
/ `first_name` / `last_name` / `email` and `ingested_contact_snapshot`
untouched. Invert `[AC-12]`.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server` only.
- **Branch:** current pack branch (see protocol).
- **Prerequisites:** none. This is the only startable issue.
- Synthetic data only. Do not enable Lead-write flags.

## 4. Current-state evidence to verify

Observed 2026-09-04; **reverify at implementation**.

- `leadDesiredState.ts` `planQualifiedContact` (~350–381): WordPress
  branch sets `granot_contact_snapshot`; else plans live contact leaves
  and `last_granot_contact_change.changed_paths`.
- `FORBIDDEN_DESIRED_PATHS` already includes `ingested_contact_snapshot`
  (~101).
- `leadDesiredState.test.ts` `[AC-12]` (~339–367) asserts live name +
  `normalized_phone_number` on a `ringcentral` Call Lead.
- `authorizedDesiredState.ts` `GRANOT_CONTACT_PATHS` (~38–45) is live
  leaves; snapshot-only plans already produce empty
  `contact_changed_paths` (Form).
- `synchronizeLeadFromGranot.ts` `buildLeadUpdate` (~526–536) stamps
  `differs_from_ingested` on `granot_contact_snapshot`.
- `createLeadFromGranot.ts` (~641–667) already writes both snapshots at
  mint. Do not change mint unless a comment would lie.

## 5. Locked decisions and invariants at risk

- Copy the WordPress branch for **all** origins in
  `planQualifiedContact`. Do not keep a RingCentral/Granot live-contact
  branch.
- Do not plan live phone/name/email. Do not plan
  `last_granot_contact_change.changed_paths` (command-derived).
- Do not plan `ingested_contact_snapshot`.
- Priority `1` / `5` still gates qualified contact. Priority `8` still
  may fill an empty receiver.
- Job fill-if-missing and `conflictingJob` stay. Move-field planning
  stays.
- `createLeadFromGranot` mint still sets live = creating contact.
- Do not change `identity.ts`. Do not change CSV. Do not change
  `sourcePolicy.ts`.

## 6. Deliverables and exact contract

1. `planQualifiedContact`: one snapshot path for every origin. Incoming
   vs `lead.granot_contact_snapshot` via `contactSemanticallyEqual`.
2. Invert `[AC-12]` and add the spec §5.1 cases (Granot-created later
   phone; Priority 8; semantic `+1` vs 10-digit).
3. Update `synchronizeLeadFromGranot` tests that expect live phone
   overwrite so they expect snapshot + unchanged live phone.
4. Confirm `toAuthorizedDesiredState` accepts a snapshot-only plan.
   A plan that includes `phone_number` from this planner is a bug.
5. Knowledge notes for CLCP-04 if comments still say Call contact
   becomes current operational fields.

## 7. Out of scope

Identity Job-wins (CLCP-02). CSV/preview (CLCP-03). Intake `q`. Admin
UI. `createLeadFromGranot` mint behavior. Flag enablement. Backfill
script.

## 8. Tests

See pack spec §10. Add or extend:

```text
src/services/granotLifecycle/leadDesiredState.test.ts
src/services/granotLifecycle/authorizedDesiredState.test.ts
src/services/granotLifecycle/synchronizeLeadFromGranot.test.ts
```

No skipped required tests.

## 9. Knowledge updates after this issue ships

Leave a one-line note in `PROGRESS.md` Cross-issue findings if
`desired-state.md` still says RingCentral contact becomes current
fields. CLCP-04 writes the Service.

## 10. Acceptance criteria

- [ ] RingCentral Call + Priority `1`/`5` plans `granot_contact_snapshot`
      only
- [ ] Live `phone_number` / `name` / `email` absent from `changed_paths`
- [ ] `ingested_contact_snapshot` never planned
- [ ] `granot_lead_created` later different phone → snapshot only
- [ ] Semantic-equal contact → no snapshot rewrite
- [ ] Priority `8` does not plan snapshot contact
- [ ] WordPress Form snapshot-only behavior unchanged
- [ ] Synchronize test: snapshot persisted, live phone unchanged
- [ ] `identity.ts` and `callLeadEnrichment.service.ts` unchanged
- [ ] Focused tests in §8 pass

## 11. Commands

```text
cd vantage-main-server
pnpm exec tsx --test src/services/granotLifecycle/leadDesiredState.test.ts
pnpm exec tsx --test src/services/granotLifecycle/authorizedDesiredState.test.ts
pnpm exec tsx --test src/services/granotLifecycle/synchronizeLeadFromGranot.test.ts
pnpm typecheck
```

Record the command and pass count in the completion report.

## 12. Risks

- Leaving a RingCentral-only live-contact branch “for Granot-created.”
  Spec locks both.
- Planning `last_granot_contact_change.changed_paths` so authorize
  rejects the plan (`FORBIDDEN_DESIRED_STATE_METADATA_PATHS`).
- Changing mint so Job-only create invents a phone.
- Touching identity “while you’re here.”

## 13. Rollback

Revert planner + authorize/synchronize tests. No data migration.

## 14. Handoff list for the completion report

- Files changed
- Test command output
- Confirmation `identity.ts` / CSV / `sourcePolicy.ts` / flags unchanged
- Note for CLCP-04: sentences that still say live Call enrichment
- Note for CLCP-02: Job-vs-phone conflict still exists until CLCP-02
