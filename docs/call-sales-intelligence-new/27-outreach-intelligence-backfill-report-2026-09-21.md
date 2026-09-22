# Outreach intelligence — trigger review and 45-day backfill

## Trigger review

The existing category order is sound. Categories represent concurrent reasons for attention, not separate Lead statuses. Each opportunity appears once in its highest-priority category and retains its other reasons. Do not manufacture a follow-up to fill an empty category.

| Owner band | Creates the condition | Clears or defers it |
| --- | --- | --- |
| No call yet after form submission | An eligible Form Lead arrives and remains Unworked. Visible immediately; overdue after 30 staffed minutes. | An attributable outbound attempt or reliably attributed inbound human conversation. A note, provider connection alone, or missed ringing does not count. |
| Missed calls with no callback | An unanswered inbound call to a mapped sales number creates an independent missed-call episode. Visible immediately; overdue after 15 staffed minutes. | A later attributable callback attempt or inbound human conversation. Repeated misses retain the first deadline; historical replay checks later fulfillment. |
| Follow-ups due | An open dated action reaches its Attention due time. Undated promises require date review and never become artificially overdue. | Completion, cancellation or an explicit reschedule. Snooze moves the reminder, while the original contractual deadline remains visible. |
| Being worked, but no next step | Outreach is Open and has no outstanding action or wait. | A real Owner action or clear, source-supported customer request/rep promise creates a step. An AI strategy suggestion alone is insufficient. |
| Open work nobody owns | The active Outreach Record or one of its independent actions lacks responsibility. | Owner assignment or existing reliable rep-identity evidence. Overall ownership and each promise's owner remain separate. |
| Going cold | No human conversation for 1,440 staffed minutes by default, measured from arrival when no human contact is known. | Human contact resets age; an actual future agreed action/customer wait defers the reason. Unanswered attempts do not reset it. |

Promised callbacks overdue remains the higher-priority special case above these six bands. Official Booked, Cancelled, Duplicate, Bad Lead and No-Sync closure wins over operational work. Identity uncertainty and contact restrictions stay visible and continue to block unsafe execution.

These are both event-driven and clock-driven conditions: arrival, attributed calls, follow-up changes, assignment and official closure change the stored facts; staffed deadlines and cold age can cross a threshold without another customer event. Keep the periodic canonical Attention publication running. Counts by primary band should be read alongside the overlapping reasons, and incomplete capture coverage must qualify any claim that no contact occurred.

## Improvements implemented

1. **Snooze no longer hides Going cold.** Previously, pushing an overdue reminder into the future also made it look like a future agreement. The calculation now uses the underlying due/base Attention date for this exclusion. Day-only customer waits still honor the next staffed opening.
2. **Grounded model repair feedback.** Live recovery exposed rejected evidence snapshot IDs and field paths. The existing single repair now receives the actual captured citation inventory beside the rejection. The server still validates all citations and effects; the runtime never substitutes citations or relaxes acceptance.
3. **Resumable, scoped backfill with durable history.** Inventory and ranking are separate from apply. The script preserves successful analyses, retries only through existing workers, and retains deterministic recovery jobs and append-only local events. It preserves normal source-based priority: historical-only imports yield to live work, while repairs of live-captured calls keep their normal priority.

## Inventory and selection

The production inventory covers **August 7, 2026 at 8:04:59 PM through September 21 at 8:04:59 PM Eastern**, an exact rolling 45-day window.

- Scanned 1,972 Form Leads and 446 Call Leads.
- Matched against 389 external Contact Numbers, excluding known company/non-customer numbers and suppressed numbers.
- Found 250 eligible matching Leads after official closure filtering; two further candidates were excluded by official Booking reference/job evidence.
- Six candidates were already in identity review and excluded from automatic selection.
- Selected 24 opportunities: 12 Form Leads and 12 Call Leads. Ranking favors unfinished recorded evidence, stronger existing attachment evidence and recency, with one selected opportunity per number. Duration does not determine eligibility.
- At most two distinct recorded interactions per opportunity are nominated, newest first. The existing workers remain responsible for later fulfillment, recording eligibility, budgets, evidence, Owner precedence and effect application.

Detailed IDs and current outcomes are saved in the gitignored `scripts/output/outreach-backfill/verification.json`. Names, phone numbers, audio and transcripts are not copied into this committed report.

## Execution results

Database verification at **September 21, 2026, 9:04:31 PM Eastern** confirmed:

| Result | Count |
| --- | ---: |
| Selected opportunities reconciled through canonical Outreach services | 24 |
| Opportunities with completed conversation intelligence | 18 |
| Completed conversations associated with the selected opportunities | 27 |
| Newly completed conversations since the inventory | 9 |
| Existing/current Number summaries available | 14 |
| Primary band: Being worked, but no next step | 18 |
| Primary band: Open work nobody owns | 6 |
| Missing responsibility as an overlapping reason | 21 |
| Likely attachments needing identity confirmation for Lead-specific AI effects | 12 |
| Open dated follow-ups | 0 |

These are reconciled existing opportunities, not 24 newly created Leads. The nine new completions correspond to nine completed recovery jobs: three in the initial recovery and six with the improved citation guidance. All six submissions from the guidance pass completed application. Existing intelligence is included only in the clearly labeled overall totals.

The final pass examined 39 nominated conversations: 12 were already analyzed, 6 submitted and applied, 14 remained paused, 4 were already dead-lettered, 2 remained in normal retry handling, and 1 failed current identity/eligibility revalidation. The paused cases were 11 contract mismatches, 2 runtime-bound exhaustions and 1 schema exhaustion. This is **not** a claim that every nominated recording completed. The report preserves these limits instead of resetting counters, changing a pinned contract or confirming identity automatically. Twelve paused recovery job attempts remain in history; several have a successful later recovery and should not be counted again as unresolved opportunities.

Known recorded cost across this task's recovery runs is **32 cents**, with **three unresolved cost records** still retained by normal budget accounting. This is not a final all-in cost or a claim that unresolved usage cost zero. Normal budget limits and reservations remain enforced.

### Owner actions

1. Review the 18 No next step opportunities and set a real dated action or customer wait where appropriate.
2. Assign responsibility on the 21 records with that overlapping reason, including the 6 whose primary band is Missing responsibility.
3. Confirm the 12 Likely Form Lead attachments only after checking the evidence. Their contextual intelligence must not be mistaken for identity-authorized Lead effects.
4. Review unclear commitments where badged. No new dated follow-up was supported and applied in this batch; do not invent a due date to fill Follow-ups due.

Detailed per-opportunity IDs, reasons, review badges, analysis/application outcomes and recovery job IDs are in the local verification and history files.

The complete canonical Attention snapshot published successfully at 9:03:08 PM Eastern, with **6,559 total rows across the production dataset** (not 6,559 backfilled Leads). A fresh Owner read at 9:04:31 PM returned **`ready`**, the same total and snapshot as-of 9:01:21 PM. The earlier 90-second build attempts expired without publishing partial data; the offline 180-second allowance completed in about 107 seconds. Normal five-minute expiry remains unchanged, so continued freshness depends on scheduled publication.

## Validation and operation

The initial full offline suite passed: **2,509 passed, 114 skipped, 0 failed** (2,623 tests). The final combined focused suite passed **23 tests**, covering selection, Outreach, captured citation inventory and the real local MCP bounded repair path. Typecheck and lint passed; the final report fields also passed typecheck.

The required model-review checkpoint was attempted. Its CLI workspace ran out of credits during review; no review patch was applied and that checkpoint is not represented as passing. The retained log is `.git/vantage-quality/runs/1790036119513-4393eeba/review.md.log`.

No schema migration or new environment variable is required. Existing Mongo and Sales Intelligence configuration is used, with the existing $80 shared monthly budget and per-recording policy left unchanged. The local operator permits 180 seconds for a full atomic Attention build; snapshot contents, filtering and five-minute expiration remain the canonical service's responsibility.

Rollback the runtime changes through a normal Git revert. Backfill analyses, evidence and audit rows are durable history; do not bulk-delete them or restore stale snapshots over later Owner work. Use the existing Owner follow-up correction/cancellation commands for any incorrect applied action. No official Lead/Booking records or customer messages are written by this script.

## Reproduction and history

From `vantage-main-server`:

```powershell
# Fresh read-only inventory and ranked selection
node --env-file=.env --env-file=sales-intelligence.env --import tsx scripts/backfill-outreach-intelligence.ts --limit=24

# Apply/resume the saved inventory (same database, less than 24 hours old)
node --env-file=.env --env-file=sales-intelligence.env --import tsx scripts/backfill-outreach-intelligence.ts --resume --apply --limit=24

# Read-only verification
node --env-file=.env --env-file=sales-intelligence.env --import tsx scripts/backfill-outreach-intelligence.ts --report-only --limit=24

# One separately deduplicated recovery using the improved citation guidance
node --env-file=.env --env-file=sales-intelligence.env --import tsx scripts/backfill-outreach-intelligence.ts --resume --apply --citation-repair --limit=24

# Retry only the full canonical Attention publication
node --env-file=.env --env-file=sales-intelligence.env --import tsx scripts/backfill-outreach-intelligence.ts --publish-only --apply
```

`history.jsonl` is append-only, while `results.json` and `verification.json` are the latest views. The earlier results and selection were copied to `results-before-recovery.json` and `selection-before-recovery.json` after the app interruption. Check that no apply process is still running before starting another. Commit `f5b33dd` preserves the first code/history checkpoint; `2590f18` preserves citation repair and recovery progress. The final report commit retains the verified outcome and reporting refinements. No separate deployment was performed; runtime rollout follows the repository's normal main-branch delivery process.
