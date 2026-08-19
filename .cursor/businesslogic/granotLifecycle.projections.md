**Platform glossary:** [`../../../CONTEXT.md`](../../../CONTEXT.md)  
**Authority:** [Final Granot Lead Lifecycle specification](../../scripts/prototypes/granot-lead-lifecycle/specs/FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md) Sections 28.2 and 29  
**Primary code:** `src/services/granotLifecycle/projections.ts`, `src/routes/granot-lifecycle-admin.routes.ts`, `src/validation/v1/granotLifecycle.validation.ts`  
**Domain terms used:** Granot Observation, Granot Booking Reconciliation Case, Job Number, Booking, Cancellation, Source Scope

# Granot lifecycle read projections

**Role:** Compose read-only, server-authoritative Booking/Release case, candidate, Job Number timeline, and Lead timeline DTOs for Vantage Admin. These reads never select or attach a Lead, resolve a case, correct a Record Link, invoke a command, or mutate an official Lead, Booking, or Cancellation.

## Protected read surface

- Owner/Admin: case list/detail, Job Number timeline, and Lead timeline.
- Owner only: case-scoped candidate browsing, because normalized owner-work contact may be used while evaluating eligibility.
- Every query is strict Zod input. Case cursors encode only the selected timestamp and ObjectId; timeline cursors encode exactly event time, type priority, and stable ID. Candidate cursors encode only Lead model/ID ordering.
- Missing cases use `GRANOT_CASE_NOT_FOUND`; a missing Lead keeps the generic v1 `Lead not found` envelope.

The default queue merges open Booking and Release cases ordered by newest evidence. `kind` filters either collection; projection-only Release mode is `release`. The selected timestamp plus ObjectId cursor is applied consistently across the merged streams, so pages neither duplicate nor omit cross-collection rows.

## Projection boundaries

- Lists contain a centralized irreversible contact label and masked Booking reference only. Raw case context/evidence arrays are absent.
- Authorized detail keeps immutable Granot evidence visibly separate from live official Booking/Cancellation fields. Create-missing `official_draft` is empty and never derives defaults from Granot evidence.
- Submitted/ingested contact and accepted Granot contact are separately labeled. Receipt payloads/headers, credentials, addresses, arbitrary Lead documents, CPL internals, and raw candidate contact never enter these DTOs.
- Booking-without-Lead detail deep-links the existing Employee Booking Lead Reconciliation work; it does not invent another matcher or selector.
- Release detail instead shows the deterministic live Booking and current Cancellation with `candidate_search.available=false`, no suggestion, no employee-reconciliation substitution, and `commands=false`.
- Referral-shaped detail disables candidate browsing. Unit 23 opens no Referral case.

## Timelines

Job Number is the primary timeline. Available Observations, individual Priority effects and Booked/Release actions, Decisions, case evidence/sequence events, Record Link changes, Entity Changes, and current official Booking/Cancellation facts remain individual entries. Sorting is ascending `(event_at, type_priority, id)` with the locked priorities 10 through 100. Invalid authoritative event time fails projection; request time is never substituted.

Pagination returns `{ items, next_cursor, current, capabilities }`. There is no hidden 100-row cap: `next_cursor` advertises remaining entries. Release-case capability is true; discrepancies remain false until Unit 29.

Lead timeline first verifies the exact Lead, then follows persisted Record Links to linked Job Numbers. It never contact-matches at read time.

## Candidate browser

The Booking reconciliation service remains the policy seam. Its canonical identity candidates retain their existing high/medium confidence and suggestion facts. Case-scoped browsing may additionally search current eligible Form/Call Leads within Source Scope or, for Owner all-scope review, across scopes. Duplicate and Bad Form Leads are excluded server-side. Job-compatible rows rank high; other browse matches rank medium. Out-of-scope rows carry `requires_override_reason=true`. This module never attaches a Lead; gated Owner confirm may consume a selected candidate when the Booking-command flag is true.

## Posture

Reads remain available for existing cases when case creation is disabled. Case/timeline `capabilities.commands` is true only for an open standard create-missing or review-existing Booking case while `GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED` is true. Release reads are advertised but Release commands and discrepancies stay false. Checked-in lifecycle flags remain processing/shadow true and every Lead/Booking/Release/Referral/email effect false.
