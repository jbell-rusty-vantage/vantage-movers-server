# Call Lead billing and Master Leads

Only a finished inbound RingCentral call to a mapped queue can create a Call Lead. The Call Log vetter uses elapsed duration (at least 120 seconds); a rounded 120-second result without sufficient precision does not qualify a new call. The webhook and cron both use final Call Log vetting.

Reads use the saved queue qualification: a recognized Call Log qualification reason, an accepted transport, a Call Log or telephony session identity, and finite duration of at least 120 seconds. The historical answered-call reason is supported, including previously accepted records stored at exactly 120 seconds. Ingestion origin, a Granot job, matching contact details, an old sheet row, and booking status cannot establish qualification. Historical RingCentral records do not need modern route IDs. New inserts also require the resolved route and assignment.

Master Leads Calls and Duplicate Calls, Form Fill and Form sibling matching, and Call Lead spend all use this evidence. Booking and cancellation entries remain reportable even when their linked Call Lead is ineligible for lead spend. A pending import booking with no eligible source may be recorded as leadless and reconciled; the external Calls worksheet cannot create a Call Lead. Granot may link to an existing Call Lead. An owner can attach an existing lead to a booking, or create a Form Lead.

## Release checks

The November 3 reporting correction adds a versioned final reconciliation and tab migration. See [operator and release record](lead-reporting-retirement/README.md); the original qualification restriction remains in force.

1. Confirm each Granot Call route is link-only or observation-only. BestRelocation Inbounds was changed to link-only on November 3, 2026.
2. Release the server before Admin. Check a saved historical qualified call and a recent qualified call against the billing filter. Confirm the next qualifying queue call receives its ordinary processed-call ledger entry.
3. Verify a source update and a booking or cancellation retry for an unsupported historical Call cannot append a Calls row. Booking and cancellation rows should still project.
4. Existing historical records are retained; no backfill or bulk sheet deletion is required for enforcement. Prior exported invoices and physical historical rows require separate reconciliation before use as current billing evidence.


## Reporting disposition

`leads/callLeadReportingDisposition.ts` owns the reporting/billing decision. Saved qualified, matched Calls are duplicates for reporting when canonical `duplicate`, `form_fill`, or a trusted imported duplicate review is set. Trusted bad reviews and confirmed same-call final parent `Missed` results arriving from 01:00 inclusive to 07:00 exclusive in America/New_York are bad. Duplicate wins while retaining all reasons. Neither exception is billable. Ordinary No-Sync affects delivery only. Unknown or conflicting final results do not become missed calls by inference.

`external_sheet_review` is protected, versioned source evidence applied through `reconcileExternalSheetReviewV1`, with an Owner initiator, checksum, revision check, Entity Change, command replay and queued Sheet Sync in one lease-fenced transaction. Arbitrary annotations remain restricted data. Public create/update contracts cannot write the fact. For Forms it supplements the primary row with a Bad Form Leads projection, including booked/cancelled/duplicate Forms; the public mark-bad restrictions remain.

Insights loads all facts the decision uses and retains separate duplicate/bad counters. Compatibility lead-cost queries apply the same Mongo predicate before aggregation. Custom Reporting keeps its versioned columns and uses the effective quality/billing decision in their values. Official Bookings and Cancellations remain reportable. Existing exported invoices are not rewritten.
