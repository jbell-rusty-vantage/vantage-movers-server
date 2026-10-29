# Refresh The Call Lead And Booking From A Booked Jobs Row — operational story

- Status: recommended; refreshed 2026-10-29.
- Target: `src/services/reconciliation/bookedCallLeadReconciliation.service.ts`
- Domain evidence: `docs/knowledge/services/booked-call-lead-reconciliation.md`
- Current exported operations/constants: `previewBookedCallLeadReconciliation`, `syncBookedCallLeadReconciliation`.
- Current exported types: `BookedCallLeadReconciliationStatus`, `BookedCallLeadMatchMethod`, `BookedCallLeadReconciliationResult`.
- Direct import sites found (resolved relative imports): `src/services/bookedCallLeadReconciliation.service.ts`, `src/services/granotCrmCsv/sync.service.ts`, `src/services/reconciliation/bookedCallLeadReconciliation.service.test.ts`, `src/services/reconciliation/index.ts`.
- Related tests: `src/services/reconciliation/bookedCallLeadReconciliation.service.test.ts`

## Current boundary and parity

Preserve the shared preview/sync matching decisions, source and job conflict handling, optimistic checks and Sheet Sync behavior. Booking intake prefers the Form Lead and the Granot Form sibling mirror is distinct from this reconciliation.

The target and its direct callers are the authority for the exact implementation. Preserve the public signatures, persisted identifiers, transaction and side-effect ordering, error shapes, and idempotency while migrating callers. Keep any existing public name as an alias until its callers move. Do not introduce an additional service class or move policy into a route.

## Remaining cleanup

Read the exported operations above in their actual order and rename only an operation whose name obscures its current outcome or scope. Keep separate operations separate where their callers own different decisions; extract a private helper only when it gives a real decision a clearer name. Migrate the direct callers together, then cover the existing success, refusal, retry and side-effect boundaries relevant to this module with targeted tests. This is a behavior-preserving naming and module-shape pass, not authorization to add effects or change business policy.

## Specific implementation checks from the original brief

1. **Show what this Booked Jobs row would refresh on a Call Lead and Booking** — parse the CRM row (sibling). Invalid when `job_no` is missing, source is missing or unknown, or the row is not `section: "bookedJobs"` and `prior` is not `"5"`. Find a Booking by exact stored `job_no`. If one exists, it must name a Call Lead; a Form Booking or a missing `lead_ref` is `conflict`. Assigned sources that disagree are `conflict`. Diff Call fields, Booking `source` / `local` / `book_date`, and whether a Customer should be inserted-or-linked by phone (`$setOnInsert` only). If no Booking exists, find an open Call Lead by exact `job_no` first (up to 25, never unmatched / booked / cancelled). Assigned-source miss on that job pick is `conflict`. Then phone (leading-boundary sieve + in-memory exact digits). Assigned-source miss on phone is `no_match`. Prefer phone hits whose stored `job_no` is empty or matches the row; a stored Job Number that differs is a warning and apply will not overwrite it. Booked Call Leads are **not** in this no-Booking pool. This adapter never mutates Mongo and never schedules Sheet Sync.

2. **Refresh the Call Lead and Booking from this Booked Jobs row** — run the same match and diff. Leftover identity / receiver drift options throw and become `failed` when a caller passes them; CSV does not. Write only when the card is `updateable` or `unchanged` **and** there is a lead update, a booking update, a customer link, or a receiver stamp. `conflict` / `no_match` / `invalid` do not write. Stamp a receiver from `granot_crm_username` only on apply, after the match, via `applyGranotCrmUsernameReceiverMatch` (`already_linked` / `not_found` warn; `matched` copies the approved snapshots onto the re-read lead). Re-price whenever a lead patch is present, not only when `local` or source changed. If preview expected no Booking (`expectedBookingId === null`) and one appears before apply, throw. After commit, schedule `booked_call_lead.reconciliation.sync` (booking chain) or `booked_call_lead.call_lead_only.sync` (lead only), plus a receiver job when the stamp changed. Status becomes `updated`. This adapter does not write phone, does not create a Booking, and does not change `lead_ref` / `lead_model`.

There is no third create operation. `no_match` stays `no_match`. `booking_missing` is in the type union and the CSV mapper; this file never emits it.

1. **`POST /call-leads/booked-reconciliation/sync` is not this file.** The route calls `applyExtensionGranotItem` with `booking_action_apply` items. Knowledge already says so. HTTP automation approved apply also must not call `syncBookedCallLeadReconciliation`. CSV Booked Jobs `--apply` is the remaining write helper. Do not point the URL back at this function so the path “matches the name,” and do not delete `syncBookedCallLeadReconciliation` so the route table “wins.”

2. **Identity / receiver drift options have no current caller.** `expectedCallLeadId`, `expectedCallLeadUpdatedAt`, `expectedBookingId`, `expectedBookingUpdatedAt`, `expectedReceiverAgent`, and `targetReceiverAgent` still throw `failed` when passed. CSV `processBookedCallRow` calls `syncBookedCallLeadReconciliation(payload)` with no options. Do not delete the guards so “CSV does not need them,” and do not wire the extension URL back through them so “preview approval is enforced.”

3. **Preview never stamps a receiver.** `showWhatThisBookedJobsRowWouldRefreshOnTheCallLeadAndBooking` does not import `applyGranotCrmUsernameReceiverMatch`. Automation `planCallWorkflow` uses find elsewhere to bind `target_receiver_agent` when the Call Lead has none. Apply stamps after the match, mutates the hydrated lead in memory, then copies those snapshots onto the re-read document inside the write. Do not start stamping during preview so the preview lead is dirty, and do not skip the in-transaction copy so “the in-memory lead is already updated.”

4. **Job Number first, then phone — and Booking before either Call pick.** Enrichment is phone first, then job, and never looks at `BookedLead`. Do not flip this file to phone-first so “the two CRM rows match the same way,” and do not OR phone+job+booking into one query so this file can reuse Call lookup.

5. **Job Number here is exact stored `job_no`.** Same as Call lookup and booked-from-source find. Identity / Granot use digit-core. Call browse contains. `P5562366` does not find `5562366`. CONTRADICTIONS already has the four Job meanings. Do not add `normalized_job_no` or `jobNumbersEquivalent` so “reconciliation finds the Job.”
