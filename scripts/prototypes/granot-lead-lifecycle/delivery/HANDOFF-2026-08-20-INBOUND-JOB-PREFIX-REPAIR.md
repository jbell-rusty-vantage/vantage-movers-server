# Handoff: inbound job-prefix conflicts + operator repair script

Date: 2026-08-20  
Repo: `vantage-main-server` (`vantage-movers-server`)  
Branch: `main`  
Start a **new agent session**. This file is the source of truth. Do not rely on the prior chat.

Owner ask that is still open: write a `scripts/` dry-run (then apply) so we can **manually repair the 12 already-written `job_number_conflict` rows**. We are **not** guaranteed another Granot `priority_updated` for those jobs. Steven Grossinger’s `Booked` webhook should have opened a booking case for the owner to finalize.

**Yes, we can still do that after activation.** The write-once activation row does not lock these 12. They were captured before the cutoff, so the live drain will never promote them. Parallel ingest (RingCentral, WordPress forms, Granot extension, manual booking) still mints ordinary Leads and Bookings. This repair is only the lifecycle evidence the prefix bug blocked — Record Links for the 10 priority jobs, and a booking **case** for Grossinger. It does not replace those other paths.

---

## Current position

### Already done and pushed

Commit **`2ae2bf8`** on `origin/main`:

`Treat inbound letter prefixes as the same Granot job in identity.`

`P5562366` ≡ `5562366`. `RF5555313` ≡ `5555313`. Different digit cores still conflict.

Changed code:

- `src/services/bookings/bookingIdentity.ts` — `jobNumberDigitCore`, `jobNumbersEquivalent`, `equivalentNormalizedJobFilter`
- `src/services/bookings/bookingIdentity.test.ts`
- `src/services/granotLifecycle/identity.ts` — `jobConflict` plus Mongo lookups for Record Link, Call job rung, Bookings
- `src/services/granotLifecycle/leadDesiredState.ts` — `conflictingJob`
- identity / desired-state tests and recording stores
- `.cursor/businesslogic/granotLifecycle.identity.md`
- `.cursor/businesslogic/granotLifecycle.desiredState.md`

`normalizeJobNo` still keeps letters. CallLead `job_no` stays `P…`. Do not migrate stored jobs.

Production must be running this commit before any repair that calls identity. Confirm the Vercel deploy of `2ae2bf8` first.

### Not done

No operator script exists yet to repair the 12 historical conflict Decisions. Waiting for another webhook is not acceptable for the 10 priority-only jobs.

---

## Activation is real — it does not block the manual repair

The write-once activation row is in production. It went through `activateGranotLifecycle`, not a Compass insert. Operational event `granot_lifecycle.activation.committed` exists. A second activate is `409`.

| Field | Value |
| --- | --- |
| Collection | `granot_lifecycle_activations` |
| Key | `granot_lifecycle` |
| Id | `6a874d02d09696e70cfdff15` |
| Cutoff `activated_at` | `2026-08-20T18:52:50.047Z` (2:52:50 PM ET) |
| Processor | `granot-lifecycle-processor-v1` |

**Do not delete this row.** If live lead-create looks wrong, set `GRANOT_LIFECYCLE_LEAD_CREATION_ENABLED=false` first.

### What activation changed from the next webhook onward

Receipts captured **before** 2:52:50 PM ET stay `historical_shadow` forever. That includes this morning’s processed decisions (the 12 conflicts live here) and the 1,251 dark backlog.

Receipts captured **at or after** that timestamp become `live` if the running server has `SHADOW_MODE=false` (owner said it is).

Best Relocation unmatched `lead_created` can now mint a Lead (`create_if_missing`). Main Site / TBM / Top10 / 10best stay `link_only`. Paid Overflow stays unclassified.

First live proof to watch (separate from this repair): one unmatched Best Relocation `lead_created` with Decision `created` / `lead_created_authorized`. A replay of the same Observation must not mint a twin.

### Parallel paths still own ordinary Leads and Bookings

These 12 are inbound 10best / Top10. Lifecycle policy there is `link_only`. Even after activation, Granot will **not** mint those CallLeads.

Leads still arrive the way they always have:

- RingCentral / call ingest → CallLead
- WordPress form ingest → FormLead
- Granot extension / HTTP automation (when present)
- Manual booking route in Vantage

So activation does not leave these 11 people without a Lead. The CallLeads already exist (that is how identity found them). What lifecycle failed to do is line the Granot job and, for Grossinger, open the owner booking case.

### Can we still fix the 12 manually? Yes.

Activation only changes **new** receipts after the cutoff. It does not freeze historical Decisions and it does not forbid an owner-gated operator script.

What will **not** work:

- Waiting for another `priority_updated` (not guaranteed)
- Dead-letter requeue (these receipts completed)
- Re-running the normal processor on these receipts (still shadow: job-level link possible, no booking case, no Lead attach)
- Deleting or re-inserting the activation row to “replay as live”
- Lying about `captured_at` to cross the cutoff

What **will** work: the `scripts/migrations/` dry-run then `--apply` described below. Owner-approved, idempotent, production-confirm gated.

- 10 priority jobs: persist the job-level Record Link identity would now allow
- Grossinger booked: call booking reconciliation so a **case** opens for the owner to finalize (extension / manual booking remain available if the owner prefers to book that way instead)
- Leave the original 12 conflict Decisions in place

---

## What happened (facts)

Granot `payload.job_no` is digits only. Across **1,390 / 1,395** receipts since Aug 12: digits only, no `P`, no letters. Five empty. Observation `job_no_raw` equals `normalized_job_no` — we did not strip a prefix.

Vantage inbound CallLeads almost always store `P` + those digits (793 of 797 inbound jobs). Three use `RF`. One is digits only.

Identity Call ladder: job lookup used exact `normalized_job_no` (missed `P…`), phone lookup found the right CallLead, then `jobConflict` did `leadJob !== observationJob` and returned `conflict` / `job_number_conflict` with one CallLead candidate.

Stock-take canvas called this “expected inbound friction.” That was wrong. Same person, same Granot job, prefix mismatch.

Canvases (context only):

- `C:\Users\Pinda\.cursor\projects\c-Users-Pinda-Proyectos-vantage\canvases\granot-lifecycle-live-stocktake.canvas.tsx`
- `C:\Users\Pinda\.cursor\projects\c-Users-Pinda-Proyectos-vantage\canvases\inbound-job-number-conflicts.canvas.tsx`

Mongo: `user-MongoDb-Vantage-Movers`, database `vantagemovers`, connectionId `preconfigured`.

---

## The 12 decisions / 11 people

All `execution_mode: historical_shadow`. Collection `synchronization_decisions`, `reason_code: job_number_conflict`. No `granot_record_link` was written for these jobs (conflict blocks `allowsHistoricalJobLink`). No FormLead on these jobs. No `booked_leads` for `5562530` or `P5562530`.

| When ET | Source | Route | Person | Granot job | CallLead job | CallLead `_id` | Observation `_id` | Decision `_id` | Receipt `_id` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2:01 AM | Top10 Inbounds | priority | Donia Carr | 5562366 | P5562366 | `6a7ced2f8335828749b0552f` | `6a86982d78429188531c3e48` | `6a86982d78429188531c3e50` | `6a7cd4df80d2f0547edc6185` |
| 2:01 AM | 10best Inbounds | priority | Steve Dority | 5562365 | P5562365 | `6a7ced2f8335828749b05533` | `6a86982d78429188531c3e49` | `6a86982d78429188531c3e57` | `6a7cd25b80d2f0547edc6172` |
| 2:01 AM | 10best Inbounds | priority | Paula | 5562295 | P5562295 | `6a7bb7ca8f162c9968b7eac7` | `6a86982d78429188531c3e5a` | `6a86982d78429188531c3e60` | `6a7cd79233f75be69fe43256` |
| 2:01 AM | 10best Inbounds | priority | Maryana Winston | 5562368 | P5562368 | `6a7ced2f8335828749b0552d` | `6a86982d78429188531c3e59` | `6a86982d78429188531c3e63` | `6a7cd6f933f75be69fe43255` |
| 10:12 AM | 10best Inbounds | priority | Steven Grossinger | 5562530 | P5562530 | `6a7f8ff6df93ba7fb544dad3` | `6a870b4d424028963e53e986` | `6a870b4d424028963e53e987` | `6a870b4da2b9f73500413ebe` |
| 10:20 AM | 10best Inbounds | **booked** | Steven Grossinger | 5562530 | P5562530 | `6a7f8ff6df93ba7fb544dad3` | `6a870d48424028963e53e98b` | `6a870d48424028963e53e98c` | `6a870d48a2b9f73500413ec9` |
| 12:37 PM | 10best Inbounds | priority | Deborah Burroughs | 5562518 | P5562518 | `6a7f57b51a997e26b125cd0e` | `6a872d415c83714a106075af` | `6a872d415c83714a106075b0` | `6a872d402f03b4f371996a15` |
| 1:42 PM | 10best Inbounds | priority | Gary Terry | 5558579 | P5558579 | `6a39b0c49cd9502b0a96877f` | `6a873c90eac3718160f4da29` | `6a873c90eac3718160f4da2a` | `6a873c8fbd5412173dc4e64a` |
| 1:52 PM | 10best Inbounds | priority | Greg White | 5558754 | P5558754 | `6a3da50ad99a0b470334f234` | `6a873ef2eac3718160f4da41` | `6a873ef2eac3718160f4da42` | `6a873ef1bd5412173dc4e658` |
| 2:04 PM | 10best Inbounds | priority | Jessica James | 5557113 | P5557113 | `6a31a9fa12f780631d6e3003` | `6a87419eeac3718160f4da8b` | `6a87419eeac3718160f4da8c` | `6a87419ebd5412173dc4e673` |
| 2:10 PM | Top10 Inbounds | priority | Arrianna Goff | 5562340 | P5562340 | `6a7c98deb3fd8c3e83d767c5` | `6a874302eac3718160f4daa5` | `6a874302eac3718160f4daa6` | `6a874302bd5412173dc4e689` |
| 2:46 PM | Top10 Inbounds | priority | Natsha Cameron | 5558051 | P5558051 | `6a30920b63617b27e8b4060a` | `6a874b75eac3718160f4daec` | `6a874b75eac3718160f4daed` | `6a874b75bd5412173dc4e6c0` |

Granularity: 10best `6a4d240f04c6e063cb6621ec`. Top10 `6a4d240f04c6e063cb6621f0`.

Re-query before acting. More conflicts may have landed after 2:46 PM ET.

---

## Why a naive reprocess is not enough

Activation row exists:

- collection `granot_lifecycle_activations`
- `key: "granot_lifecycle"`
- `activated_at: 2026-08-20T18:52:50.047Z` (2:52 PM ET)
- `_id: 6a874d02d09696e70cfdff15`

Every receipt above has `captured_at` **before** that cutoff. Spec: `captured_at < activated_at` stays `historical_shadow` forever. Shadow Decisions are never replay-promoted into live effects.

Owner requeue (`requeueDeadLetterReceipt` in `src/services/granotLifecycle/operations.ts`) is **dead-letter only**. These receipts completed. That endpoint will not take them.

If you only re-run the processor on these receipts:

- Still `historical_shadow`
- After the prefix fix, identity should return `linked` to the CallLead
- Historical shadow is then allowed to write a **job-level** `GranotRecordLink` (digits, no `lead_ref`)
- It will **not** attach the CallLead, **not** mutate the Lead, **not** create a Booking, **not** open `granot_booking_reconciliation_cases`

That is why Grossinger has no booking case: identity conflicted before booking reconciliation ran, and a shadow replay still will not open the case.

---

## What “fixed” means (owner intent)

1. **Grossinger `5562530` booked snapshot** (`receipt 6a870d48a2b9f73500413ec9`, observation `6a870d48424028963e53e98b`): open a booking reconciliation case so the owner can finalize. That is the live-path outcome that identity blocked.
2. **The other 10 jobs** (plus Grossinger’s earlier priority): do not wait for another `priority_updated`. Repair must work from the existing Observation/Receipt. Minimum: prove identity now links the named CallLead; persist the durable lifecycle evidence that historical shadow is allowed to write (job-level Record Link). Do **not** invent a Booking for priority-only rows.
3. **Do not rewrite or delete** the original `job_number_conflict` Decisions. They are the historical record of the old compare. A repair may add a later Decision/attempt or an operator audit row. Confirm the existing decision uniqueness / attempt rules before inserting.
4. **Do not strip `P` from CallLeads.**

---

## Script plan the next agent should implement

Follow existing operator style. Closest patterns:

- `scripts/migrations/README.md` — report-by-default, reject unknown DBs, `--apply --confirm-production=<db>`, PII-safe JSON under gitignored `scripts/output/`
- `scripts/migrations/granot-lifecycle-migration.lib.ts` — database preflight
- `scripts/migrations/granot-lifecycle-shadow-process.ts` — processor invoke + forbidden-collection snapshot (do **not** reuse as-is; it is certification shadow, not this repair)
- `docs/granot-lead-lifecycle/production-operator-runbook.md`

Suggested new files (names can change, keep the gates):

- `scripts/migrations/granot-lifecycle-inbound-job-prefix-repair.ts`
- `scripts/migrations/granot-lifecycle-inbound-job-prefix-repair.lib.ts`
- `scripts/migrations/granot-lifecycle-inbound-job-prefix-repair.test.ts`

### Phase 1 — dry run / `--report` (no writes)

For each conflict Decision (query live, do not hardcode only the table):

1. Load Observation + named CallLead + any Record Link / Booking / booking case for the digit job **and** `P`/`RF` variants (`jobNumbersEquivalent`).
2. Re-run `resolveLeadIdentity` in-process (read-only store) with current code.
3. Report: old outcome vs new outcome, match method, target CallLead id, whether jobs are prefix-equivalent, whether a Record Link already exists, whether this observation is a `booked` action.
4. For Grossinger booked: also dry-run `classify` / booking reconciliation **without committing**. Report whether a case *would* open and why (gates, execution mode, missing booking, identity).
5. Write PII-safe JSON to `scripts/output/` (ids, jobs, outcomes — no phones/emails/names in the file if the runbook forbids it; names are ok in the agent chat).

Success for report: every row in the table shows identity would now `linked` to the listed CallLead. Grossinger booked shows “would open booking case if allowed to run the booking seam.” Different-digit jobs still conflict.

### Phase 2 — decide the apply seam (do not guess)

Read before writing apply:

- `src/services/granotLifecycle/processor.ts` — `allowsHistoricalJobLink`, `decidePreparedOutcome`, `classifyExecutionMode`
- `src/services/granotLifecycle/bookingReconciliation.ts` — what opens `GranotBookingReconciliationCase`
- Unit 26 / Unit 29 issues if the case kinds are gated
- Decision uniqueness / attempt increment

Likely apply split:

- **Priority rows:** operator-approved write of the job-level Record Link the processor would have written had identity not conflicted. Stay inside historical-shadow rules. Do not attach `lead_ref` unless the spec explicitly allows an operator attach. Prefer calling the same persist helper the processor uses over hand-rolled inserts.
- **Grossinger booked:** owner-approved run of booking reconciliation against that Observation so a case opens. This is the exception: a case is owner work, not a silent Booking mint. Confirm flags (`post_activation_live_mode`, booking effect flags). If the processor refuses because the receipt is pre-cutoff shadow, the script must call the reconciliation module directly with an explicit operator reason — **not** fake `live` by lying about `captured_at` or deleting the activation row.

Apply gates (copy the other migrations):

- default `--report`
- `--apply` requires `--confirm-production=vantagemovers`
- refuse historical / unknown DB names
- `SHEET_SYNC_MODE=disabled`
- print the exact writes before commit
- idempotent: second apply is a no-op if the link/case already exists

### Phase 3 — verify

Re-query:

- 10 priority jobs: active `granot_record_links` on the digit job (or equivalent), still no Booking
- Grossinger: open `granot_booking_reconciliation_cases` on `5562530`, still no silent `booked_leads` unless the owner command path is what the module does (it should be a case, not an official Booking)
- original 12 Decisions unchanged
- no `entity_changes` / Sheet jobs unless the booking module requires them — fail the report if surprise writes appear

---

## Identity compare sites (already fixed in 2ae2bf8)

One string compare: `jobConflict` in `identity.ts` (~1161). Call sites: Form exact, Form contact, Call `classifyCallLeads` (Record Link, job rung, phone rung).

Same-class lookups (also fixed): `findActiveRecordLink`, `findCallLeadsByScopedJob`, `findBookingsByNormalizedJob`.

Not a job-string compare (leave alone): job-rung vs phone-rung different lead ids; `multiple_bookings`; booking owner ≠ ladder target.

After identity: `leadDesiredState.conflictingJob` (fixed).

---

## Do not

- Wait for Granot to resend priority on those 10 jobs
- Force-push or amend `2ae2bf8`
- Include the unrelated dirty file `docs/granot-lead-lifecycle/lifecycle-activation-flags-and-source-policies.md` unless the owner asks
- Rewrite CallLead `job_no`
- Delete or mutate the original conflict Decisions
- Create official Bookings from a repair script
- Delete the activation row, Compass-insert a second one, or fake `captured_at` / `live` to promote these 12
- Run apply against production without a clean report the owner has seen

---

## First actions in the new session

1. Read this file and `2ae2bf8`.
2. Confirm production deploy is `2ae2bf8` or later.
3. Re-count `synchronization_decisions` with `reason_code: job_number_conflict` in `vantagemovers`.
4. Read `bookingReconciliation.ts` enough to know the case-open contract.
5. Implement `--report` first. Show the owner the JSON. Only then implement `--apply`.
