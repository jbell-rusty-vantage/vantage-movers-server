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

## Remaining

Finish selected analyses/application and Number summaries without bypassing live work or budget limits; publish and verify the normal Attention snapshot; preserve per-run outcomes; write final owner report; rerun applicable checks; commit only this task's files and push main. The worktree contains unrelated pre-existing edits and untracked cleanup scripts; do not include them.

Run from the server root with existing environment files:

```powershell
node --env-file=.env --env-file=sales-intelligence.env --import tsx scripts/backfill-outreach-intelligence.ts --resume --apply --limit=24
```

`--resume` requires an inventory less than 24 hours old and matching the current database. Do not start a second apply process while one is alive. No customer messages, official Lead/Booking updates, or production deployment are authorized by the script.
