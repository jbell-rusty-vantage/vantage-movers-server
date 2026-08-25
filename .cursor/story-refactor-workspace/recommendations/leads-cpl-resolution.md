# Lead CPL — operational story

- Status: recommended
- Service: `leads` (Wave A, in-progress)
- Pass: 6 of this service — `leadCplResolution.ts`
- Remaining in this service: `leadLocation.service.ts`, `leadName.service.ts`, `leadPhoneMatching.ts`, `sourceLeadLookup.service.ts`, `callLeadSourceMatch.ts`, `leadSourceCompatibility.ts`
- Target: `src/services/leads/leadCplResolution.ts`
- Knowledge: `docs/knowledge/services/form-lead.md` (CPL snapshot + after-commit `lead.cpl.missing_rate`), `docs/knowledge/services/call-lead.md` (RingCentral `duplicate_zero`; Admin create omits `duplicate`), `docs/knowledge/services/operations-registry.md` (`cplSchedule.ts` is authority; this file is the Lead write adapter), `docs/knowledge/services/bookings.md` (from-source override reports missing; unmatched Call create prices with `applicable: false`). No dedicated Service file for this module. This checkout’s `CONTEXT.md` does not define CPL — do not invent a glossary copy.
- Callers: `formLead.service.ts` (ingest + correct), `callLead.service.ts` (RingCentral ingest, Admin/sheet ingest, correct), `granotLifecycle/createLeadFromGranot.ts` (after-commit report), `bookings/bookedLeadFromSource.service.ts` (source override), `bookings/bookingSourceResolver.ts` (unmatched Call create), `bookings/bookingMirror.service.ts` (price only), `employeeBookings/bookingLeadAttachment.service.ts` (attach + recon create), `enrichment/callLeadEnrichment.service.ts` (price only), `reconciliation/bookedCallLeadReconciliation.service.ts` (price only), `ringcentral/callLeadConvergence.service.ts` (Duplicate Call zero)
- Seams callers need: price the Lead (stamp a persistable snapshot) vs report a hole after commit; `duplicate` is Call-only zero; `applicable: false` is “we chose not to price,” not a missing rate
- Split later (only if the file outgrows one sitting): `priceTheLead.ts`, `reportAMissingLeadCplRate.ts` — never `create.ts` / `update.ts` / `delete.ts`

## What this file actually does

Two operations, not “a CPL helper” and not schedule CRUD:

1. **Price the Lead** — a Form or Call write already knows the Source Granularity and the Lead’s stored Eastern business timestamp. Ask the Operations Registry what that day costs. Stamp dollars, the period (or a cleared period), how the lookup went (`resolved` / `duplicate_zero` / `missing_rate` / `not_applicable`), when we asked, and the v1 version so the Lead can persist it.
2. **Report a missing CPL rate** — the write already succeeded with compatibility zero. After commit, tell the owner the schedule has a hole and that a correction job is the fix.

`resolveLeadCplSnapshot` / `recordMissingLeadCplRate` are executor mechanics. The owner question is: *what did this Lead cost us on that Eastern business day, and if we do not know, did we tell the owner?*

`operationsRegistry/cplSchedule.ts` is not this file. That module owns periods, cents, and covering-window lookup. `cplCorrections.ts` is not this file. That is the separate Owner rewrite of prior Leads. Legacy `cpl.ts` / `getCplForSource` are older reads, not the write-path authority.

## Organization

Keep one file. This is the screenplay for “this Lead costs this much today.” Period coverage, Eastern midnight conversion, and schedule writes already live in `operationsRegistry`. Observability already records the event. Do not pull those in. Do not pull Form/Call ingest, booking, Granot create, or the leftover `cpl/` folder. Do not invent a `LeadCplService` class.

If it later outgrows one sitting, split by **story** (price vs report), not by Form vs Call folders.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `resolveLeadCplSnapshot` | `priceTheLead` | every Lead write that must persist a CPL snapshot |
| `recordMissingLeadCplRate` | `reportAMissingLeadCplRate` | owner-visible hole after the write; ingest/Granot keep this **after commit** |

Keep the old names as one-line aliases until Form/Call ingest, Granot create, booking, employee-booking attach, enrichment, booked-call-lead reconciliation, and RingCentral convergence migrate. Do not make callers learn `resolve` / `record` as the domain language.

`LEAD_CPL_RESOLUTION_VERSION` stays exported. It is the stamp that this snapshot came from Registry CPL v1, not a second operation.

The injectable `deps.resolver` and `deps.now` stay. They are the test **seam** for “we asked the Registry this way” and “we asked at this instant,” not a second public operation.

**No class for the workflow.** The types that *do* earn names are the ask and the stampable snapshot:

```ts
type LeadCplToPrice = {
  sourceGranularityId?: string | null
  storedBusinessTimestamp: Date
  duplicate?: boolean           // Call Lead only; Form never sends this
  applicable?: boolean          // false = unmatched Call invented for a Booking
}

type LeadCplSnapshot = {
  cpl: number
  cpl_rate_period?: string | null
  cpl_resolution_status: CplResolution["status"]
  cpl_resolved_at: Date         // when we asked, not the business day
  cpl_resolution_version: typeof LEAD_CPL_RESOLUTION_VERSION
}
```

Do not export the status switch. It is a child of stamp.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// leadCplResolution.ts
// A Lead is about to be saved.
// We know the Source Granularity and the Eastern business day on the Lead.
// Ask the Registry what that day cost. Stamp it.
// If the schedule has a hole, the write still succeeds —
// tell the owner after commit.

// ── 1. Price the Lead ─────────────────────────────────────

export async function priceTheLead(ask, deps?)

function convertTheStoredEasternWallClockToABusinessDay(stored)
async function askTheRegistryWhatThatDayCosts(prepared, resolver)
function stampWhatTheLeadWillRemember(resolution, whenWeAsked)
  // resolved        → dollars + period
  // duplicate_zero  → $0 + keep base period when we found one
  // missing_rate    → compatibility $0 + cleared period
  // not_applicable  → $0 + cleared period (we chose not to price, or no granularity)

// ── 2. Report a missing CPL rate ──────────────────────────

export async function reportAMissingLeadCplRate(lead)
```

Read the ordinary ingest path out loud: *take the stored Eastern wall-clock Date, convert it to that calendar day’s New York midnight, ask the Registry for the Source Granularity’s covering period. If one period covers that instant, stamp the dollars and the period id. Always stamp when we asked and the v1 version. After commit, if the status is missing_rate, tell the owner to add schedule coverage and run a correction.*

Read the Duplicate Call path out loud: *the caller already decided this Call Lead is a Duplicate Lead. Still convert the Eastern day and ask. Stamp zero. Keep the base period when the Registry found one, so Analytics can see which rate we refused. Do not emit missing_rate.*

Read the unmatched-Booking path out loud: *we are inventing a Call Lead because a Booking had no source Lead. Pass applicable false. Stamp not_applicable zero. Do not tell the owner the schedule is broken — we chose not to price.*

That is the operation. `resolveLeadCplSnapshot` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`duplicate` is Call-only.** Form ingest, Form correction, Granot create, enrichment, booked-call-lead reconciliation, Admin/sheet Call create, and employee recon create omit the flag. A Duplicate Form Lead still gets a real rate. RingCentral ingest, Call correction (when `duplicate` or source/timestamp changed), from-source override, booking mirror, employee attach, and RingCentral convergence pass `duplicate: lead.duplicate` (or `true`). Keep that split visible. Do not “fix” Form create to send `duplicate` so the statuses look symmetric.

2. **`applicable: false` is only unmatched Call create.** `bookingSourceResolver` is the one caller. Missing granularity also becomes `not_applicable` inside the Registry. This file stamps the same bag either way (`cpl: 0`, cleared period). Do not invent a third status here. Do not emit `lead.cpl.missing_rate` for `not_applicable`.

3. **`missing_rate` is not a failed write.** Compatibility zero is the snapshot. The owner event is the second operation. Do not throw from `priceTheLead` when the schedule has a hole. Do not fold the report into the stamp “to make sure we never forget.”

4. **Callers disagree on when to report.** Form/Call ingest and Granot create report **after commit**. Public from-source override reports right after `lead.save()` on the standalone path, and in `finalize` on the canonical path. Employee recon create reports **inside** the Mongo session. Mirror, enrichment, booked-call-lead reconciliation, and unmatched create never report. Name that in those later passes. Do not move report inside `priceTheLead`, and do not silently add events to the price-only callers.

5. **`cpl_resolved_at` is “when we asked,” not the business day.** The business day is the stored Eastern wall-clock mapped to New York midnight by `storedLeadTimestampToCplInstant`. Keep that conversion in the Registry. Do not reimplement UTC-component → `YYYY-MM-DD` here.

6. **Granot create prices `observation.captured_at`, not a Florida Lead timestamp.** That is a caller choice in `createLeadFromGranot`. Do not change the conversion here so Granot “looks like ingest.” Do not route Granot through `toFloridaTimestamp`.

7. **Leave the Registry and the correction job alone.** Covering windows, cents, explicit-zero rates, and schedule writes stay in `cplSchedule.ts`. Prior-Lead rewrites stay in `cplCorrections.ts` (they ask `resolveCpl` themselves). Do not call `priceTheLead` from the correction worker “for DRY.” Do not move `resolveCpl` into `leads/`.

8. **Leave sibling modules alone.** Assign returns the granularity id; this file prices it. Location, Duplicate Lead, and provenance stay out. Do not call `assignLeadSource` from here.

9. **The leftover `cpl/` folder is a later Wave A service.** Older reads. Do not merge it into this file because the names overlap.

## Testing

The **interface** is the test surface: `priceTheLead` (today `resolveLeadCplSnapshot`) and `reportAMissingLeadCplRate` (today `recordMissingLeadCplRate`).

Today’s `leadCplResolution.test.ts` injects a resolver and covers three stamp paths: Eastern calendar-day mapping (`2026-07-29T23:30:00.000Z` → Registry midnight `2026-07-29T04:00:00.000Z`), Duplicate Call zero keeps `base_period_id`, missing rate is compatibility zero with a cleared period. Keep the injectable resolver and `now`. Fill the gaps the story names make obvious:

**Price the Lead**
- Resolved stamps `cpl`, `cpl_rate_period`, status `resolved`, `cpl_resolved_at` from `deps.now`, and `operations-registry-cpl-v1`.
- Stored Eastern wall-clock converts before the Registry sees `business_timestamp` (today’s first test).
- `duplicate: true` → status `duplicate_zero`, `cpl: 0`, period is `base_period_id` or `null`.
- `missing_rate` → `cpl` is the fallback (0), period is `null` (today’s third test).
- `applicable: false` → `not_applicable`, `cpl: 0`, period `null`. No owner event from this function.
- Missing `sourceGranularityId` → same `not_applicable` stamp (Registry short-circuits; this file still stamps).
- `duplicate` omitted (Form / Admin Call) is forwarded as undefined; do not default it to `lead.duplicate` here.

**Report a missing rate**
- Emits `lead.cpl.missing_rate` with Form vs Call entity type, granularity id/key, and the remediation sentence.
- Dedupe key is `lead.cpl.missing_rate:${leadModel}:${leadId}`.
- `ownerVisible` and `notificationCandidate` stay true. `piiPolicy` stays `none`.

Do **not** add a test per helper (`convertTheStoredEasternWallClockToABusinessDay`, `stampWhatTheLeadWillRemember`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** add Mongo or live Registry tests here. The injectable resolver is the **adapter**. Covering windows and cents are `operationsRegistry` tests.

Form/Call ingest tests should prove they priced before persist and reported after commit when status is `missing_rate`, not re-implement Eastern midnight.

## What I would not do

- A `LeadCplService` class with `resolve` / `record` / `correct`.
- Thirty two-line functions that only spread `common` or pick `period_id`.
- Moving this into a CRUD folder, or into `cpl/` / `operationsRegistry/` “because it talks to the schedule.”
- Treating Owner CPL correction, schedule writes, or legacy `getCplForSource` as this story.
- Passing Form `duplicate` into `priceTheLead`, or emitting `lead.cpl.missing_rate` for `not_applicable` / `duplicate_zero`.
- Folding the owner event into the stamp, or throwing on `missing_rate`.
- Reimplementing `storedLeadTimestampToCplInstant`, or changing Granot to use a Florida Lead timestamp from here.
- Silently adding reports to mirror / enrichment / reconciliation / unmatched create.
- Calling Source Assignment, Duplicate Lead, or Sheet Sync from here.
