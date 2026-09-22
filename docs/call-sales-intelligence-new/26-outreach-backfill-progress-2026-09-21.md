# Outreach intelligence backfill — progress and handoff

User request: improve Outreach band triggers, inventory unbooked Form/Call Leads in the past 45 days, process the best recorded opportunities through the existing LLM pipeline, report results, commit and push on main. User subsequently requested durable file history after an app crash.

## Saved evidence

Private, gitignored operational files are in `scripts/output/outreach-backfill/`:

- `inventory.json`: successful production scan, as of 2026-09-22 00:04:59 UTC (September 21 Eastern). Window starts 2026-08-08 00:04:59 UTC.
- `selection.json`: 24 selected opportunities, 12 Form Leads and 12 Call Leads; all have recorded conversation candidates.
- `results.json`: latest checkpoint of completed candidate processing. Do not infer successful LLM completion from Outreach seeding alone.
- `history.jsonl`: append-only execution events, added after the crash/recovery request.

Inventory found 1,972 Form Leads and 446 Call Leads, 389 external Contact Numbers, and 250 eligible matching Leads after official closure filters and two additional Booking-reference/job exclusions. Candidate Outreach states: 36 Form Unworked, 169 Form Open, 6 Form Identity review, 32 Call Unworked, 7 Call Open. Identity-review candidates are excluded from automatic selection. Conversation counts are candidate associations, not distinct recordings: 185 transcribed, 250 complete, 42 discovered, 7 unavailable, 1 failed.

## Work completed before restart

- Reviewed canonical Outreach, analysis, attachment and eligibility services and their existing contracts.
- Corrected Going cold: reminder snooze no longer impersonates a future agreed action date. Future contractual/base Attention dates, including day-only waits, still defer Going cold. Added and passed a regression test.
- Added separate inventory, selection and execution scripts to preserve existing unrelated demo-backfill edits.
- Inventory initially timed out on broad reads. Selecting only operational Lead fields produced the successful scan. A small native Mongo probe succeeded; no proven network root cause was established.
- Initial apply attempt rejected a non-ObjectId worker request identity inside the transaction. Fixed it to use the existing deterministic payload hash convention. No partial transaction was committed.
- First two selected records passed Outreach reconciliation; their existing analyses were not claimable. Paused prior runs include `schema_exhausted` and `bounds_exhausted` from both GPT-5 Mini and GPT-5.6 Luna. Existing runs and retry counts were preserved.
- Added one deterministically deduplicated recovery job per transcript for those two bounded failure reasons only. The worker still checks current policy, budget, evidence, identity and live priority. Recovery uses eight steps with unchanged cumulative token caps and a 240-second invocation ceiling.
- At restart, recovery job `6ab1c9490c84337849a2e421` was pending behind live Number synthesis work. Its process had survived and was waiting; no provider invocation had been reported by this recovery job.
- Last budget probe: $80 ceiling, $17.03 actual, $7.20 reserved. This is a shared snapshot, not the cost of this task.
- Typecheck passed after the runner fixes. Outreach tests: 8 passed. Selection tests: 2 passed.
- Required `pnpm finish-work --provider codex --no-apply` was invoked; its review CLI exited 1. Artifacts: `.git/vantage-quality/runs/1790036119513-4393eeba/`. Inspect `review.md.log` before retrying. No quality patch applied.

## Remaining at the earlier checkpoint

### Recovery checkpoint — 2026-09-22 00:49 UTC

- Commit `f5b33dd` preserves the first implementation and progress file. No push yet.
- The first full reconciliation completed all 24 selected opportunities. The normal 90-second Attention build returned `incomplete/snapshot_budget`; no partial snapshot was published.
- At 00:44 UTC, verification found 14 selected opportunities with completed conversation intelligence, 14 Number summaries, 18 primary No next step rows and 6 primary Missing responsibility rows. These include prior intelligence; three completed conversations were newer than the inventory. There were no open dated follow-ups.
- All 12 selected Form Leads require identity confirmation before Lead-specific AI effects. Phone matching remains Likely; this task does not confirm identities for the Owner.
- Live model failures showed rejected snapshot IDs/field paths. Added captured citation inventory to the existing bounded repair response and tested the real local MCP repair path. A distinct, deterministic `citation-guidance-v1` recovery pass started at 00:48 UTC. Existing failed runs/counters remain intact.
- Full offline tests passed (2,509 passed, 114 skipped, zero failed). Focused selection/Outreach tests passed 10; focused prompt/runtime tests passed 20. Typecheck and lint passed. The model-review CLI failure was insufficient workspace credits; no model review completion is claimed.
- Current process writes `citation-repair.log` and append-only `history.jsonl`. Before resuming after another interruption, check for the surviving Node process before starting any apply command.

Finish selected analyses/application and Number summaries without bypassing live work or budget limits; publish and verify the normal Attention snapshot; preserve per-run outcomes; write final owner report; rerun applicable checks; commit only this task's files and push main. The worktree contains unrelated pre-existing edits and untracked cleanup scripts; do not include them.

Run from the server root with existing environment files:

```powershell
node --env-file=.env --env-file=sales-intelligence.env --import tsx scripts/backfill-outreach-intelligence.ts --resume --apply --limit=24
```

`--resume` requires an inventory less than 24 hours old and matching the current database. Do not start a second apply process while one is alive. No customer messages, official Lead/Booking updates, or production deployment are authorized by the script.

## Completed bounded run — 2026-09-22 01:04 UTC

Final results are in [the trigger review and backfill report](27-outreach-intelligence-backfill-report-2026-09-21.md). Both apply passes exited successfully. All 24 selected opportunities were reconciled; nine new conversation analyses completed, including six with the citation guidance. Eighteen opportunities now have completed conversation intelligence (27 associated completed conversations total). There are 14 available Number summaries, 18 primary No next step records, 6 primary Missing responsibility records and no open dated follow-ups. Twelve selected Form Leads still require identity confirmation for Lead-specific AI effects. Unresolved contract, bounds, schema, retry, exhausted and identity cases are explicitly retained in the report.

Canonical publication succeeded with 6,559 rows; a fresh Owner read returned `ready`. Verification is saved in `verification.json`, publication identity in `publication.json`, complete per-candidate results in `results.json`, and append-only events in `history.jsonl`. Known recovery usage is 32 cents with three unresolved cost records; no reservation was manually released.

Final typecheck, lint and 23 focused tests passed, in addition to the earlier full offline suite. The required model-review checkpoint remains unavailable because its CLI workspace ran out of credits. Checkpoints `f5b33dd` and `2590f18` preserve implementation and recovery history; the final report commit is intended for the same authorized push to main. Unrelated pre-existing work remains outside these commits.
