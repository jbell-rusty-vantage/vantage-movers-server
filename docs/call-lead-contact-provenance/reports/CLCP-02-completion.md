# CLCP-02 completion

Closed 2026-09-04. Repo `vantage-main-server`, branch `call-lead-contact-provenance`.

## Behavior

`resolveCallLadder` returns a unique Job / Record Link target before the phone rung. After `jobMatch` has a target (`call_job_no_exact` classified linked), it returns that result and does **not** call `findCallLeadsByScopedPhone`. A different Call Lead whose operational or ingested phone equals the Observation phone is not a competing candidate and does not emit `job_number_conflict`. Record Link `fromLink.stop` still returns before the Job/phone block.

Phone still runs when Job / link miss (first bind). Call phone `$or` stays current `normalized_phone_number` plus `ingested_contact_snapshot.normalized_phone_number`. Two eligible Jobs still `conflict` / `multiple_eligible_matches`. Lead Job ≠ Observation Job still `job_number_conflict` via link evaluation and phone-rung `jobConflict`. Form ladder unchanged.

## Files changed

- `src/services/granotLifecycle/identity.ts` — unique Job/link target returns before `findCallLeadsByScopedPhone`; removed Job-vs-phone `job_number_conflict` compete block
- `src/services/granotLifecycle/identity.test.ts` — inverted unique Job vs other ANI; added first-bind no-Job phone, two Job candidates, Call phone `$or` source scan
- `docs/call-lead-contact-provenance/issues/CLCP-02.md` — §10 boxes checked with evidence below
- `docs/call-lead-contact-provenance/PROGRESS.md` — close ledger
- this report

## Test command output

```text
pnpm exec tsx --test src/services/granotLifecycle/identity.test.ts
ℹ tests 29
ℹ pass 29
ℹ fail 0
ℹ skipped 0

pnpm typecheck
tsc --noEmit
exit_code: 0
```

No required test failed or was skipped. `identity.module.test.ts` was not changed and was not re-run.

## Call phone `$or` omits `granot_contact_snapshot`

`findCallLeadsByScopedPhone` (`identity.ts` ~273–288) `$or` is only:

- `normalized_phone_number`
- `ingested_contact_snapshot.normalized_phone_number`

Confirmed by source-scan test `Call phone query omits granot_contact_snapshot` (extracts that function body; asserts no `granot_contact_snapshot`; asserts current + ingested remain). Form contact `$or` still includes snapshot; that is Form-only.

## Intake Call `q` / `callLeadCandidateSearchOr` untouched

`src/services/granotLifecycle/projections.ts` `callLeadCandidateSearchOr` was not edited. Git status after this issue does not list `projections.ts`.

## Note for CLCP-04

`docs/knowledge/granot-lifecycle/identity.md` Call ladder still says “Job and phone pointing at different eligible Leads are `conflict`.” After unique Job bind that sentence is false: Job wins and competing phone is not computed. CLCP-04 owns the Service rewrite.

## Untouched (confirmed)

This issue did not edit:

- `src/services/granotLifecycle/leadDesiredState.ts` (CLCP-01)
- `src/services/enrichment/callLeadEnrichment.service.ts`
- `src/services/granotLifecycle/sourcePolicy.ts`
- `src/services/granotLifecycle/projections.ts` (`callLeadCandidateSearchOr`)
- `src/services/granotLifecycle/processor.test.ts` (`job_number_conflict` stub for Job-vs-Job still exists)
- `src/services/granotLifecycle/identity.module.test.ts`
- `.env` / feature flags / Admin / extension

## Acceptance criteria evidence (issue §10)

| Box | Evidence |
| --- | --- |
| Unique Job + Observation phone = other Lead’s ANI → linked on Job Lead, not `job_number_conflict` | Inverted `Call unique Job wins when Observation phone matches a different Lead`: Lead A Job `SYNTH JOB 14A`, Lead B operational phone `5550001111` → `linked` / `call_job_no_exact` on A; candidates omit B; `call_scoped_phone` query not invoked |
| No Job + matching operational/ingested phone → still phone bind | New `Call with no Job on the Lead still binds by operational phone` (Observation has Job, Lead has none, operational phone hits → `source_scoped_contact`); existing `Call current and ingested phones dedupe to one Lead` still passes |
| Two eligible Call Jobs still conflict | New `two eligible Call Jobs are a conflict` → `conflict` / `multiple_eligible_matches`; existing `[AC-08]` two phone candidates still conflict |
| Call phone query still omits `granot_contact_snapshot` | Function body ~273–288 plus source-scan test |
| Form ladder tests unchanged | `multiple eligible Form contact candidates are ambiguous` still `ambiguous`; Form contact still ORs snapshot in the recording store |
| `callLeadCandidateSearchOr` / Connect Call `q` unchanged | `projections.ts` not in this issue’s diff |
| Focused tests in §8 pass | Commands above: 29 pass, 0 fail, 0 skipped; typecheck clean |

## What this issue did not do

CLCP-03 CSV/preview. CLCP-05 desk `q`. Knowledge Service rewrites (CLCP-04). Planner / `leadDesiredState.ts`. Flag enablement. Processor `job_number_conflict` still exists for Job-vs-different-Job; that fixture stubs identity and was not inverted.
