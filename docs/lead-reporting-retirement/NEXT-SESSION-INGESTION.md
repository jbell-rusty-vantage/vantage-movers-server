# Next session: exact Best Relocation manual ingestion

Owner direction recorded November 3, 2026, after the reporting/shutdown release. **Planning handoff only: do not execute source ingestion in the handoff session.** The Owner will return in another session to direct the exact run. This document supersedes the old broad source-create preview; it does not release a frozen plan or the durable ingestion hold.

**Owner-return update, November 3:** the Owner has now confirmed the rules below and requested completion. The current session uses a fresh capture with a fixed watermark and implements the Booking restriction before applying the new exact checksum. References to the held “handoff session” describe the earlier session; they do not cancel this subsequent direction. The old preview remains unreleased. Implementation/local proof and actual deployment, source application, physical delivery and replay are tracked separately in [README](README.md) and [RELEASE](RELEASE.md); this note is not completion evidence.

## Outcome the next session must deliver

Use a manually invoked, bounded, resumable script built on the existing canonical ingestion commands and Sheet Sync. Read the real external tracker and shared Booked Deal responses/refunds, freeze the evidence, reconcile against Mongo, review the exact action list, apply once and prove a same-plan replay. Keep recurring external ingestion and Granot `create_if_missing` closed. Mongo remains the system of record; physical spreadsheet editing must not bypass it.

The Owner's new policy is:

1. Ingest all in-scope bad/duplicate Forms and Calls identified under the agreed checker and canonical duplicate rules, with their exclusive exception-tab destinations in Master Leads.
2. Idempotently ingest every in-scope Best Relocation Booking, covering Inbounds, Forms and Local Forms, and write every canonical Booking to **Master Booked**, regardless of whether a Lead can be attached. Multiple source responses for one Booking must not produce multiple Bookings or physical rows.
3. Ingest supported refunds as Cancellations when they have a very high-confidence, unique Booking match. Keep ambiguous/unmatched refunds in a concrete review report instead of guessing an attachment or dropping them silently.
4. Apart from the explicitly requested exception entries in item 1, create a missing normal Call Lead or Form Lead **only with a definite match to an in-scope Booking**. Reuse an existing Lead first. Unbooked normal source rows must not create Leads or normal Master Leads rows.

The lower bound remains **April 30, 2026, midnight America/New_York**, `2026-04-30T04:00:00.000Z`. Pin a through-watermark for each approved capture; honor the source workbook timezone and the appropriate dataset event timestamp. Do not exclude an in-scope Booking merely because its candidate Lead is older, missing or ambiguous. Refund scope must retain evidence linking it to the eligible Best Relocation Booking, including when the refund response itself has incomplete source attribution.

“Every Booking” requires complete source-to-canonical accounting: a missing Lead is allowed; missing financial data or an irreconcilable identity needs repair or an explicit unresolved row. Never invent amounts, create one Booking per duplicate response, silently omit a valid Booking, or call an incomplete financial import complete.

## Checker mapping and precedence already agreed

Use actual resolved cell values and retain raw annotations with protected provenance. Valid formula results that resolve to annotation text still classify normally. Formula/header sentinels, structural rows and formula errors are review conflicts, not bad-lead reasons.

| Source | Rule | Destination |
| --- | --- | --- |
| Calls, `Form Fill Checker` | Normalized exact `Form Fill`, `Duplicate`, `Duplicate Call` | Duplicate Calls |
| Calls, `Form Fill Checker` | Other genuine nonempty text | Bad Call Leads, unless canonical duplicate/Form Fill precedence applies |
| Forms or Local Forms, `Bad Lead Checker` | Genuine value longer than two trimmed characters | **Bad Form Leads exclusively** |
| Forms or Local Forms | Canonical duplicate without a qualifying bad annotation | Duplicate Forms |

Blank, whitespace and one/two-character Form notes, including `no`, do not make a bad Form. Under the prior explicit rule, `Duplicate Form`/`Duplicate` in the **Form Bad Lead Checker** is still a bad annotation; preserve the canonical duplicate flag but use Bad Form Leads exclusively. Do not change this semantic distinction because a note contains the word “duplicate” without a subsequent Owner instruction.

For Calls, canonical duplicate and factual Form Fill take precedence over a bad annotation. Preserve all review evidence even where precedence chooses a different exception tab. For bad Forms, confirm successful Bad Form Leads delivery before removing stale Forms/Duplicate Forms rows. Preserve domain duplicate, Booking and Cancellation facts. A booked bad/duplicate Lead stays in its exception tab; its official Booking remains in Master Booked.

## Matching and creation requirements to implement

The current operator is a foundation, **not an implementation of the new Booking-bounded creation policy**. Do not execute the old preview or merely toggle its held flags.

- Build a deterministic identity/match graph across the source tracker, shared Booking responses, refunds, successful historical receipts and canonical Leads/Bookings/Cancellations. Show the exact evidence and selected canonical target per action. Respect Source Company and Source Granularity boundaries.
- Prefer durable source receipt/identity and exact reviewed Booking/job links, supported by consistent contact/source data. A same-phone candidate alone, nearest timestamp alone, “Booked” checkbox, fuzzy name, or a heuristic score alone is not a definite Lead-to-Booking match. Record ambiguity explicitly. Do not guess a numeric “very high” threshold absent evidence and calibration.
- Separate source-row identity from canonical Booking identity. Resolve duplicate submissions before applying money or attaching Leads. Match/refund ordering must not depend on source row order. Never move one Granot job onto two Leads.
- Reuse existing Leads and Bookings conservatively. Retain existing legitimate links and protected fields; differences require explicit reconciliation with expected revisions. Do not duplicate canonical records because a timestamp representation or source label differs.
- Gate new normal Forms **and** Calls on a persisted, checksum-bound, definite Booking match. A create plus its Booking/link dependencies must be replayable even after interruption. A leadless Booking must not depend on a successful Lead create; create/attach a proven missing Lead through the existing audited path when permitted.
- Prove that exception-only creates cannot briefly leak into normal Calls/Forms through an intermediate queue delivery before their protected classification is applied. Preserve destination-before-cleanup behavior. Preserve the existing billing contract: duplicate Forms and duplicate/bad Calls are excluded from normal lead spend; a bad annotation alone does not make a nonduplicate Form unbillable. Exclusive Bad Form Leads routing is not a new Form billing rule.
- Keep the protected final-source Call admission path and imported automation suppression. No fabricated RingCentral evidence, CRM posting, confirmation SMS, outreach enrollment or ordinary external/manual/Granot Call creation. Do not extend the closed 69-ID historical compatibility manifest to admit new IDs.
- Bind action types, selected source rows, exact matches, canonical targets, expected revisions, disposition, financial values and dependencies into the new plan checksum. Any changed selection or evidence creates a new plan/checksum; never hand-edit a signed plan into a new meaning.

The old 125-row normal-Call list is a **review inventory**, not an approved create list. Re-evaluate every row under the new policy; only the Booking-proven subset could become eligible in the next session. The old preview also proposed 1,024 new Forms and 39 exception Calls: none ran, and those proposals must not be inherited as approval.

## Execution and completion proof

1. Start from the actual server `main` checkout; read [OWNER-CLARIFICATION](OWNER-CLARIFICATION.md), this document and [RELEASE](RELEASE.md). Confirm the latest Owner direction before releasing the next exact plan. No need to seek permission again for already authorized read-only preparation or reversible implementation work.
2. Recheck actual deployed commit and DB identity, Source Company activity, both `link_only` policies, disabled connection/cron/queue, hold, relevant leases and preserved baseline financial rows. Do not enable the retired UI/APIs or recurring ingestion to capture sources.
3. Decide with the Owner whether to reuse the frozen capture or take a fresh capture/tail. Keep its timezone, source cell values, stable identity sidecar and a fixed through-watermark. Do not mix live source reads into a frozen apply. Keep snapshots, contacts, notes and per-ID outputs private/gitignored.
4. Implement and test the Booking restriction before generating the next dry run. Report selected exception rows; reused vs created Leads; skipped unbooked normal rows; all Booking responses and collapsed Booking identities; matched/refused refunds; protected-field/identity conflicts; exact proposed normal Call creates; financial totals and destination tabs. Account for every source row once.
5. Bind the Owner-directed selection to a new checksum and the existing deferred-run approval. The CLI currently refuses apply/resume without `--owner-release-ingestion-hold`; the durable transaction also requires `owner_released_deferred_ingestion_checksum === run.plan_checksum`. New normal Calls additionally require their insert approval. Do not bypass these fences, edit DB approval fields ad hoc, or use this handoff as a release of the old plan.
6. Apply through the canonical executor/receipts/outbox under the bounded lease. Resume only the exact approved plan. Preserve existing official financials and maintain reporting even when a Lead remains unresolved. Keep the connection disabled and the Source Company active after the one-time run.
7. Drain required Sheet Sync work and independently verify actual Mongo facts, financial totals and **physical row membership by canonical ID**, including Master Booked, cancellation reporting and all six Master Leads tabs. A success receipt or published job is not proof of delivery. Existing financial rows outside the selection must remain unchanged.
8. Replay the same frozen plan and verify zero additional Leads/Bookings/Cancellations, source applications, revisions, financial amounts or physical rows. Prove crash/resume, repeated Booking responses, duplicate source identities, ambiguous refunds, conflicting existing attachments, booked bad/duplicate Leads, mixed channels, unbooked normals and both permitted/forbidden normal creates. Use a local replica for transactional tests, never production for test fixtures.
9. Mark final source reconciliation complete only after all approved rows and delivery/financial proofs close; report any remainder explicitly. Do not rerun the already completed independent November 1 general Call backfill as a prerequisite.

The Owner requested GPT 6.1 Sol subagents where applicable. Use them for independent match-plan review, source accounting, financial/membership verification and replay review. Keep mutation ownership with one operator; do not let parallel agents apply overlapping plans.

## Existing implementation and evidence entry points

- [Operator and existing modes](README.md#operator-tooling): `ops/best-relocation-retirement/run.ts`, `sourceSnapshot.ts`, `sourcePlan.ts`, `sourceCalls.ts`, `sourcePlanCache.ts`, `financialVerification.ts`.
- Canonical ingestion: `src/services/bestRelocationSheetIngest/`; protected commands: `src/services/domainCommands/`; policy: `src/services/leads/{callLeadAdmission,externalSheetReview,callLeadReportingDisposition,legacyBestRelocationCalls}.ts`.
- Read the Service docs before changing behavior: [Bookings](../knowledge/services/bookings.md), [Cancellation](../knowledge/services/cancelled-lead.md), [Domain commands](../knowledge/services/domain-commands.md), [Sheet Sync](../knowledge/services/sheet-sync.md), [Google Sheets](../knowledge/services/google-sheets.md), [Ingestion](../knowledge/services/ingestion.md).
- Successful reporting/shutdown runtime: server `267b3dbe728205c49d7deb704a6b6d707cef49b5`, [Actions 41734373111](https://github.com/jbell-rusty-vantage/vantage-movers-server/actions/runs/41734373111), production `dpl_65hSQGwMGwQLXgHNYns9hSbHbTFz`; Admin `d6a91f6664b7499cdd4ecfdf8b0ba2727f821069`. This handoff's documentation commit will be a descendant; use the real live deployment stamp when applying later.
- Final production compatibility and shutdown readbacks: restricted original server `scripts/output/best-relocation-retirement/historical-compatibility-{before,after}.json`, `final/shutdown-verification-1793747075014.json`, `final/final-deployed-release.json`. Independent Sol review passed. No final source ingestion occurred, including exception rows.
- Old capture/preview and unresolved evidence are indexed in [RELEASE, deferred source work](RELEASE.md#deferred-source-work-and-private-evidence). The old snapshot/plan are evidence only. Known review issues include six duplicated Local Form source rows, two protected `over_2000` differences, five uncertain exception Call identities, three normal Call rows with same-phone/different-time candidates, and seven uncertain Booking-to-Lead links. Eleven captured Booking responses previously collapsed to ten existing Bookings; this is not a guarantee for a fresh capture.

The temporary next-session handoff records machine-specific checkout/credential locations and the source inventory. No credentials, contacts or raw notes belong in committed documents.
