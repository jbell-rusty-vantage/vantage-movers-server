# Granot discrepancy review and Record Link correction

Unit 29 implements the exception-work boundary for conflicting Booking and Release evidence. A discrepancy records an independently reclassified conflict; it is never authority to create, update, cancel, reverse, or reactivate an official Booking/Cancellation or to alter a Lead's attribution.

## Durable work and reasons

Booking and Release use separate collections and models:

- `GranotBookingDiscrepancy`: `booked_record_link_conflict`, `booked_booking_lead_conflict`, `booked_job_number_conflict`, `booked_source_scope_conflict`, or `booked_after_official_cancellation`.
- `GranotReleaseDiscrepancy`: `release_without_vantage_booking`, `release_record_link_conflict`, `release_job_number_conflict`, or `release_source_scope_conflict`.

Normal missing-Booking work, pending/ambiguous Lead matching, deferred policy, already-cancelled Release, and a Booking missing its Lead do not become discrepancies.

The open-work identity is a lowercase SHA-256 over canonical JSON containing every key in this tuple:

```text
version, discrepancy_kind, normalized_job_no, reason_code,
record_link_id, lead_ref, booking_id, cancellation_id
```

Absent references remain explicit `null` values. Contact, source labels, raw Job text, Observation/Decision IDs, timestamps, display values, and revisions are excluded. Each collection has one partial unique open-fingerprint index plus a state/newest-evidence queue index. Evidence is append-only and deduplicated by Observation ID; resolving a row preserves it permanently.

## Routing and flags

The processor passes a typed conflict seam, but the discrepancy service reloads the accepted Observation and current Vantage facts before persistence. Open/refresh and its immutable Decision commit in one lifecycle transaction. The unique partial index is the final race guard and one bounded retry converges simultaneous evidence.

There is no discrepancy flag. Automatic Booking discrepancies require the existing Booking-case flag; Release discrepancies require the Release-case flag. Live mode, post-activation evidence, and reviewed source gates still apply. Shadow/historical work and disabled flags create no discrepancy. Checked-in case and command flags remain false.

## Protected reads

Signed Owner/Admin reads are:

```text
GET /api/v1/admin/granot-lifecycle/discrepancies
GET /api/v1/admin/granot-lifecycle/discrepancies/:id
```

The list supports kind, state, exact reason, normalized Job, source ID, opened range, stable cursor/sort, and bounded limit. It returns a masked contact label and bounded references only. Detail separates immutable evidence from current link/Lead/Booking/Cancellation facts and returns server-derived current candidate suggestions and action capabilities. Raw payload, headers, credentials, address, and unmasked contact are absent.

Job timelines show discrepancy open/refresh/resolution independently from Record Link supersession/correction. Admin routing, fingerprinting, and candidate eligibility remain server-owned.

## Owner commands

All mutations require trusted Owner auth, exactly one printable `Idempotency-Key`, strict bodies, server checksum, route-owned discrepancy identity, current revisions, and causal Receipt/Observation/Decision/discrepancy provenance:

```text
POST /api/v1/admin/granot-lifecycle/discrepancies/:id/re-evaluate
POST /api/v1/admin/granot-lifecycle/discrepancies/:id/correct-record-link
POST /api/v1/admin/granot-lifecycle/discrepancies/:id/no-action
```

`reEvaluateGranotDiscrepancy` reloads current facts without re-normalizing raw payload. An unchanged conflict stays open without revisions, Changes, cases, or Sheet work. A new conflict resolves the old row and opens/refreshes the new fingerprint atomically. Normal reconciliation resolves the discrepancy and opens/refreshes the production Booking/Release case in the same transaction; officially satisfied state resolves without a case.

`resolveGranotDiscrepancyNoAction` writes only the canonical Command and discrepancy resolution, incrementing the owner revision once. It creates no `EntityChange`, aggregate mutation, link, case, Sheet work, notification, or email.

`correctGranotRecordLink` is limited to an open link/Lead/Job/Source conflict whose Granot link is active and disputed. The server revalidates discrepancy/link revisions and selected Lead eligibility; Duplicate or Bad Form Leads are rejected. A Lead outside the old scope requires the Owner reason, but the Lead's authoritative Source Company, Source Granularity, Ingestion Origin, CPL, and business fields never change.

One canonical transaction supersedes the old link, creates the replacement active link, appends one `EntityChange` for each link, resolves the discrepancy, stores the Command, and opens/refreshes any now-valid normal case. The old link is retained with its dispute/evidence and `superseded_by` reference. No official aggregate or Sheet mutation occurs. Replay returns the stored result; stale discrepancy/link revisions fail with stable `409` codes.

## Admin conflict recovery and rollback

The Admin queue and detail routes expose only explicit Re-evaluate, Correct Record Link, and Resolve — No Action controls advertised by the server. Candidate buttons populate the draft; manually entered eligible Leads are still server-validated. A `409` refetches current facts, preserves the selected Lead and reason, explains the revision change, and never auto-resubmits. Success invalidates discrepancy, Job/Lead timeline, affected case, and link-derived queries. Audits retain masked refs/outcome metadata and omit Job, contact, reason prose, and raw responses.

Rollback is caller-side disablement: hide/disable correction first, then disable the narrow Booking- or Release-case flag if automatic creation is faulty. Keep capture, processing, and protected reads available. Never delete/reopen/rewrite discrepancies or links, decrement revisions, reverse official facts, or enqueue automatic compensation. A wrong correction requires a separately reviewed canonical correction with current revisions.
