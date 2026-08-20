# Unit G — Booking Reconciliation and Release Reconciliation tabs

> **Contract maturity: implementation-ready.** Implementation-blocked until ODV-A lands. The Booking half is buildable immediately after A; the Cancellation half additionally requires **Granot Unit 26**. This unit is a list and a handoff. It deliberately does **not** reimplement the Owner command workflow.

## 1. Authority and required reading

- **Specification:** **challenge 0.1 (capability states), challenge 0.2 (what a Release Reconciliation actually is), challenge 0.8 (why this is a handoff, not a drawer)**, §3.2, §3.3, §6.5.
- **Wireframes (illustrative only):** `owner-daily-view-planned.txt` §5, §5a.
- **The workflow this unit hands off to — read it before deciding anything:**
  - `src/routes/granot-lifecycle-admin.routes.ts` — `confirm-booking`, `update-booking`, `no-action`, `cases`, `cases/:id`, `cases/:id/candidates`
  - `vantage-admin/components/granot-lifecycle/case-detail.tsx`, `booking-command-form.tsx`, `booking-update-form.tsx`, `no-action-form.tsx`, `lead-candidate-browser.tsx`
  - Granot delivery issues UNIT-23, UNIT-24, UNIT-25
- **For the Cancellation half:** Granot delivery issues UNIT-26 and UNIT-27.

## 2. Objective

Deliver two window-bounded, capability-gated lists of open intake cases that hand off to the existing Owner command workflow. Prove that the candidate-lead search the Owner asked for already exists and needs no new work. Ship the capability states so both tabs are legible on day one, when one is flag-disabled and the other does not yet exist.

## 3. Repository, branch, and prerequisites

- **Repositories/branches:** `vantage-main-server` and `vantage-admin` on the sprint branch.
- **Prerequisites:** ODV-A complete. ODV-B complete for the shared provenance component.
- **Hard gate on the Cancellation half:** Granot Unit 26 (Release Reconciliation persistence and projections) must exist. Until then, ship only the `not_built` capability panel for that tab.
- Redacted synthetic data. `TEST_MODE=true`. No commit, push, deploy, production apply, live payload read, or external send.
- **No Granot flag is enabled by this unit.** If the Owner wants to see live intakes, that is a separate authorized flag decision.

## 4. Current-state evidence to verify

Observed 2026-08-19; reverify at implementation:

- `GET /api/v1/admin/granot-lifecycle/cases` already supports `kind`, `state`, `mode`, `source_id`, `normalized_job_no`, `opened_from`, `opened_to`, `sort`, `order`, `cursor`, `limit`. It returns `GranotLifecycleCaseListItem[]` already masked, with `suggestion` confidence available on the detail.
- `GranotLifecycleCaseListItem` carries `case_id`, `kind`, `state`, `mode`, `normalized_job_no`, `job_no`, `source`, `masked_contact_label`, `latest_action`, `evidence_count`, `opened_at`, `last_evidence_at`, `deterministic_booking`.
- The existing case list is **not** window-bounded. This unit adds the window on top; it does not change the Granot route.
- `GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED` is **false** in checked-in defaults, so the production posture on day one is `not_activated` with zero rows. That is the expected state and it is a test.
- `cases/:case_id/candidates` exists and is Owner-only. In-scope by default; out-of-scope selection requires a reason at command time. **This is the lead search the Owner asked for.**
- Admin lifecycle components live at `/ingestion/granot/lifecycle`, gated by `OWNER_ONLY_PAGE_PREFIXES` `/ingestion/granot`.
- No Release/Cancellation case model exists. Granot UNIT-26 is `ready`, not complete.

## 5. Locked decisions and invariants at risk

- **Do not reimplement the command workflow.** Confirming a Booking involves exact-cent allocations that must equal `total_binder_amount`, an `Idempotency-Key`, expected case and Booking revisions, one-winner concurrency, stored replay, and a `409` that preserves the Owner's draft. Forking any of that forks the logic most dangerous to fork.
- **Do not put the command form in a drawer.** Specification challenge 0.8. The failure mode of a cramped overlay here is losing typed work.
- **"Release Reconciliation" means Release Reconciliation (Granot Units 26–27).** It is **not** `BookingLeadReconciliationCase`, which is the employee-booking workflow. Conflating them would route the Owner to the wrong queue.
- **Capability, never an empty table.** A flag-disabled tab renders its flag name and a link to lifecycle health. An unbuilt tab names the unit that will build it.
- **Window-bound on `last_evidence_at`**, display `opened_at`. Specification §3.2.
- Read-only. This unit issues no command, no case resolution, and no Record Link change.

## 6. Deliverables and exact contract

### 6.1 Routes

```text
GET /api/v1/admin/owner-daily/intakes/booking       ?window &mode &cursor &limit
GET /api/v1/admin/owner-daily/intakes/cancellation  ?window &mode &cursor &limit   [Granot Unit 26]
```

Owner-only. Implemented in `src/services/ownerDaily/intakes.service.ts` as a **thin adapter** over `listGranotLifecycleCases` — apply the window as `opened_from`/`opened_to` equivalents on `last_evidence_at`, apply the capability gate, and re-shape to the Daily View item. Do not duplicate the Granot query, its masking, or its cursor.

When the capability is not `available`, return `200` with `{ items: [], capability, window }` — **not** an error and not a bare empty list. The Admin renders from `capability`.

### 6.2 Item shape

```ts
export type DailyIntakeListItem = {
  case_id: string;
  kind: "booking" | "release";
  mode: string;
  opened_at: string;
  last_evidence_at: string;        // the window bound
  age_ms: number;
  job_no: string;
  normalized_job_no: string;
  source_label: string | null;
  latest_action: "priority_5" | "booked" | "release";
  evidence_count: number;
  suggestion: {
    present: boolean;
    masked_label: string | null;
    confidence: "high" | "medium" | null;
  };
  href: string;                    // deep link into the existing case detail
};
```

`href` is exactly:

```text
/ingestion/granot/lifecycle/cases/<case_id>?return=/daily?tab=booking-intakes&window=<mode>
```

URL-encode the `return` value. The existing case detail must honour `return` with a breadcrumb back to the Daily View — that is the one change this unit makes to existing lifecycle components, and it must not alter their behaviour when `return` is absent.

### 6.3 Admin

| Path | Deliverable |
| --- | --- |
| `components/daily/booking-intakes-tab.tsx` | List, mode filter, `[Open →]` handoff |
| `components/daily/cancellation-intakes-tab.tsx` | Same shape, gated on Granot Unit 26 |
| `components/daily/intake-list.tsx` | Shared row renderer for both |
| `components/granot-lifecycle/case-detail.tsx` | **Additive only:** honour a `return` query parameter with a breadcrumb |

The `Age` column is the reason this tab exists — the Owner is triaging by how long something has waited. Render it prominently and sort by it descending by default.

Suggestion confidence renders as a visible chip: `HIGH`, `MED`, or `— ambiguous`. An ambiguous suggestion is a signal, not an absence.

### 6.4 Capability panels

Reuse ODV-A's `components/daily/pane-capability.tsx`. Content per wireframe §5a:

- `not_activated`: name the exact flag (`GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED`), state that the workflow is built and tested, and link to lifecycle health.
- `not_built`: name Granot Unit 26 and state that release evidence is captured but opens no case.

## 7. Explicitly out of scope

- **Any Owner command.** Confirm, update, and no-action stay where they are.
- Any candidate search UI. It exists at the case detail.
- Any change to case opening, refresh, sequencing, or resolution.
- Enabling any Granot flag.
- Implementing Release Reconciliation itself — that is Granot Unit 26.
- Discrepancy routing — Granot Unit 29.

## 8. Flags and runtime posture

- **No new flag.** This unit reads `GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED` and reports it; it never sets it.
- The expected production posture on delivery is `not_activated` for Booking Reconciliation and `not_built` for Release Reconciliation. **Both tabs must be demonstrably correct in that state** — that is the day-one experience.

## 9. Migration and indexes

**No new index.** Granot Unit 22 already declared the five Booking-case indexes, including one supporting `last_evidence_at` ordering. Verify the windowed query uses it via `explain()` and record the plan. If it does not, report it as a follow-up rather than adding an index here.

## 10. Acceptance criteria

- [ ] With `GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED` false, the Booking Reconciliation tab renders `not_activated` naming that exact flag — **not** an empty table — and the endpoint returns `200` with a capability, not an error.
- [ ] With Granot Unit 26 absent, the Release Reconciliation tab renders `not_built` naming Granot Unit 26.
- [ ] With the flag enabled on a test database holding seeded cases, the list renders window-bounded rows sorted by age descending.
- [ ] A case whose `last_evidence_at` is inside the window but `opened_at` is outside it **appears** — the window binds on evidence, not opening.
- [ ] `[Open →]` navigates to the existing case detail, which renders a breadcrumb back to `/daily?tab=booking-intakes` preserving the window.
- [ ] The case detail behaves identically to before when `return` is absent. Proven by an existing-behaviour regression test.
- [ ] No command route is called, no case is resolved, and no Record Link changes from any action in this unit.
- [ ] `grep` proves no candidate-browser, confirm-booking, update-booking, or no-action logic was duplicated into `components/daily/`.
- [ ] Suggestion confidence renders as `HIGH`, `MED`, or `— ambiguous`, and an ambiguous case is visually distinct from one with no suggestion field.
- [ ] Masked contact only. No unmasked contact in any intake list payload.
- [ ] `explain()` plan for the windowed case query is recorded.
- [ ] No Command, Change, revision, outbox row, case mutation, or notification is produced.

## 11. Required tests and commands

```bash
pnpm test
pnpm typecheck
cd ../vantage-admin && pnpm test && pnpm typecheck && pnpm build
```

Focused tests:

- `intakes.service.test.ts` — capability gating returns `200` with an empty list; the `last_evidence_at` vs `opened_at` window case as a named test; adapter fidelity to `listGranotLifecycleCases` output.
- Route test: Owner-only gating, window validation, capability response shape.
- Admin: both capability panels render their exact content; `[Open →]` href construction and encoding; case-detail `return` breadcrumb present and absent.
- Regression: existing case-detail behaviour unchanged without `return`.

## 12. Live/staging verification

Preview deploy both repositories. Verify in the **default flag-off posture** first — both capability panels must read correctly, because that is what the Owner will actually see. Then, on the test database only and with the case flag enabled in that environment, verify the list, the age sort, and the round trip to case detail and back.

**No production flag change. No production deploy. No live payload read.**

## 13. Rollback

Remove both tabs from the shell tab list. Revert the additive `return` breadcrumb in `case-detail.tsx`. Then unmount the two routes. No data was written and no Granot behaviour changed.

## 14. Required completion handoff

Report: files added; the `explain()` plan; the grep proving no command logic was duplicated; screenshots or descriptions of both capability panels in the default posture; the regression proof that case detail is unchanged without `return`; test, typecheck, and build output; explicit confirmation that no Granot flag was changed and no command was issued.

**Unblocks:** nothing. Note in the handoff whether Granot Unit 26 has since landed, and if so whether the Cancellation half was completed or deferred to a follow-up.
