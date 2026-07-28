# Operations Registry Specification

Status: Owner-approved implementation specification
Date: 2026-07-28

## 1. Objective

Complete the existing Operations Registry so production operational
configuration can be created, edited, activated, deactivated, resolved, and
audited without a code deployment.

The registry must be one domain module rather than a generic collection editor.
It owns validation, lifecycle, temporal scheduling, dependency checks, cache
invalidation, and deterministic resolution for:

- Form Lead Ingestion
- Call Qualification and Call Lead Ingestion
- booking owner workflows
- Granot receiver-agent matching
- CRM source labels
- Analytics and filters
- Master Leads and optional source-sheet projection metadata

## 2. Scope boundary

Only the production `vantagemovers` database is in scope. The implementation
must not import historical models, query `vantagemovershistorical`, offer
historical-scope mutations, or attempt database consolidation.

In this specification, "prior production leads" means existing records in
`vantagemovers`. It does not mean the separate historical database.

Moving Carriers, External Data Ingestion, Reporting Definition models, and
Granot extension automation are outside this delivery.

## 3. Owner capabilities

### Agents

The owner can:

- create and rename an Agent;
- edit role and active state;
- configure one globally unique Granot username;
- view verification and last-observed state;
- view usage/dependency counts;
- include inactive Agents in an explicit selection;
- archive/deactivate without deleting historical references.

A configured Granot username is immutable through ordinary dashboard editing.

### Merchants

The owner can:

- create and rename a Merchant;
- activate, deactivate, and inspect usage;
- include inactive Merchants in an explicit booking selection;
- preserve prior booking snapshots.

### Source Companies and Source Granularities

The owner can:

- create a Source Company as an incomplete draft;
- edit owner labels, aliases, sheet metadata, and active state;
- create and edit first-class form/call Source Granularities;
- select active form and call defaults;
- inspect alias and exact-identifier conflicts;
- explicitly use inactive records in corrective owner workflows;
- see linked CPL schedules and RingCentral routes.

`company_slug`, `granularity_key`, ObjectIds, and an activated RingCentral phone
identity are stable. Display names and labels may change.

### CPL

The owner has two editing modes backed by the same temporal schedule.

Simple Mode:

- shows one current value per active Source Granularity;
- allows any number of rows to be changed;
- uses one shared effective date, defaulting to today in New York;
- validates the complete command first;
- applies all changed rows transactionally or applies none.

Advanced Mode:

- shows past, current, and future periods;
- adds, splits, closes, and corrects periods;
- prevents gaps and overlaps for active granularities;
- supports explicit zero-dollar periods;
- previews affected prior production Leads before a correction job.

Ordinary Simple or Advanced schedule edits never rewrite existing Lead
snapshots.

### RingCentral routes

The owner can:

- create an inbound number as an inactive draft;
- correct an unvalidated/failed draft number;
- validate the number against the configured RingCentral account;
- activate only after successful account validation;
- assign or immediately reassign it to an active call granularity;
- activate more than one number for the same call granularity;
- deactivate an old number without changing existing Call Leads;
- inspect provider metadata and recent call observations.

Recent qualifying calls are not an activation requirement. They are evidence
only.

### Registry health and audit

The owner can inspect:

- missing or ambiguous source resolution;
- exact identifier and priority conflicts;
- active granularities without continuous CPL coverage;
- Leads saved with unresolved CPL;
- RingCentral validation failures;
- active route/assignment inconsistencies;
- registry cache refresh failures;
- migration/backfill results;
- sanitized before/after mutation history.

## 4. Shared lifecycle rules

- The dashboard performs no hard deletions in this release.
- Deactivation reasons are optional.
- Deactivation hides a record from normal selection and automatic resolution.
- Owner workflows may explicitly reveal and select inactive records with a
  warning.
- Existing records using inactive values remain editable without forced
  replacement.
- Automatic ingestion, default resolution, Granot matching, and RingCentral
  qualification use active records only.
- Source defaults and active RingCentral assignments must point to active
  records.
- Reactivation restores the same canonical record.
- Renames preserve ObjectIds and stable keys.
- Previous normalized Agent/Merchant names remain lookup aliases.
- Historical Lead and Booking label/name snapshots are not rewritten.

## 5. Agent and Granot invariants

- An Agent has at most one Granot identity subdocument.
- One normalized uppercase Granot username maps to at most one Agent globally.
- Granot account/workspace/origin variants and aliases are not modeled.
- A configured username is immutable through ordinary commands.
- The legacy flat `granot_crm_username` remains temporarily for compatibility.
- Automatic receiver matching ignores inactive Agents.
- Explicit owner correction may select an inactive Agent.
- Agent display-name changes do not change Granot identity or old snapshots.

## 6. Merchant invariants

- Normalized canonical names and aliases resolve deterministically.
- Two active Merchants cannot claim the same normalized canonical name.
- Inactive Merchants are omitted from default booking choices.
- An owner may explicitly book or edit with an inactive Merchant after a
  warning.
- Existing Booking merchant strings remain valid snapshots.

## 7. Source invariants

- `company_slug` is immutable and globally unique.
- `granularity_key` is immutable and globally unique.
- A Source Granularity belongs to exactly one Source Company.
- Channel is `form` or `call` and becomes immutable after activation/use.
- A company with active granularities in a channel must have an active default
  for that channel.
- A default belongs to the same company and correct channel.
- Deactivating a current default requires a replacement in the same command or
  removal of all automatic use for that channel.
- New Source Companies are not blocked by compile-time TypeScript unions/maps.
- An active company does not require a dedicated source Google Sheet.
- Master Leads remains the standard projection.

Exact active identifiers must be unambiguous:

- granularity key;
- RingCentral phone number;
- exact CRM label when used for resolution;
- exact source-site identifier within a channel.

Fallback/legacy aliases may overlap only when priority resolves them
deterministically. Equal-priority ambiguity fails rather than selecting
arbitrarily and creates an Operational Event.

## 8. Sheet metadata rules

- `LeadSourceCompany` owns the source workbook/container ID.
- `LeadSourceGranularity` owns its tab name.
- Source Company projection mode defaults to `derived_import`.
- In `derived_import`, source workbooks are populated by owner-configured
  Google Sheets import formulas from Master Leads.
- Merely storing a workbook ID or tab name never enables server direct writes.
- `direct_write` is an explicit opt-in and requires a complete validated
  workbook/tab mapping.
- This registry work stores and validates metadata; it does not build generic
  Reporting Definitions.

## 9. CPL temporal rules

### Time contract

- Business timezone is `America/New_York`.
- The owner enters business dates, not UTC timestamps.
- A start date begins at local midnight and is inclusive.
- An owner-facing end date is inclusive.
- The server converts it to the next local midnight as exclusive
  `effective_until`.
- Storage uses UTC instants and also retains business date values/timezone for
  lossless API display.
- DST start and end boundaries require focused tests.

### Schedule integrity

- A period belongs to one Source Granularity.
- Amount is a non-negative dollar value with at most two fractional digits.
- Canonical rate storage uses integer cents.
- Active granularities require continuous coverage from activation/cutover
  onward.
- An active schedule has no overlaps, no gaps, and one open-ended final period.
- Free traffic is represented by an explicit zero-dollar period.
- Draft/inactive granularities may have incomplete schedules but cannot become
  active until coverage is valid.
- Concurrent writes use a granularity schedule revision and transaction; stale
  clients receive a conflict with the current revision/schedule.

### Lead resolution

Resolution uses the Lead's business `timestamp`, never `createdAt`.

On success, a Lead stores:

- existing dollar `cpl` snapshot;
- rate-period reference;
- resolution status;
- resolution time;
- resolver version.

Duplicate Call Leads remain zero CPL. The covering base rate period should
still be retained when available so the override is explainable.

If no period covers a paid Lead:

- save the Lead;
- retain `cpl: 0` for backward compatibility;
- set `cpl_resolution_status: "missing_rate"`;
- leave the rate-period reference absent;
- record an actionable Operational Event;
- show it in Registry Health;
- exclude or separately disclose it in trustworthy CPL totals.

The zero value in this state is not a legitimate zero-dollar rate.

### Production corrections

Corrections are a distinct, production-only workflow:

- preview before applying;
- explicit confirmation;
- optional reason;
- durable, resumable batches;
- idempotent re-entry;
- update `lead.cpl`, period reference, status, and correction metadata;
- invalidate/recompute affected production Analytics;
- audit request, progress, and result.

No correction code may import historical models or connect to the historical
database.

## 10. RingCentral invariants

- Provider is fixed to `ringcentral`.
- Phone numbers normalize to one E.164-like representation.
- A normalized number maps to at most one granularity at a given instant.
- One granularity may have multiple active phone numbers.
- Only a `call` granularity may receive a route.
- Assigned company, granularity, route, and assignment must be active for new
  qualification.
- A failed or unvalidated draft cannot activate.
- Validation confirms that the number exists and is accessible in the
  configured RingCentral account.
- Absence of recent calls does not invalidate the number.
- No owner override bypasses failed account validation.
- A validation failure returns an editable, actionable response and records an
  Operational Event; it does not crash the dashboard.
- A draft phone may change before first activation.
- After first activation, phone identity is immutable.
- Reassignment is immediate and records a new assignment interval.
- Future scheduling is not supported.
- Delayed calls resolve assignment by call start time.
- Call Leads persist route, company, and granularity snapshots.
- Webhook and Call Log paths use the same resolver and qualification function.
- Call Qualification remains inbound + mapped route + answered + caller phone
  + at least 120 seconds.
- Qualification rules are server constants in this release.

A future rule extension may introduce named Mongo contracts mapped to vetted
server qualification functions. Arbitrary executable rules in Mongo are never
allowed.

## 11. Audit, operational events, and authorization

### Authorization

- Owner role may mutate registry state and run CPL corrections.
- Other authenticated dashboard roles have read-only registry access.
- Runtime services receive read-only query/resolver interfaces.
- The server verifies signed dashboard actor context; plain client-provided
  identity headers are insufficient.

### Audit layers

`operations_registry_changes` is the authoritative domain mutation log. The
entity mutation and its registry change record commit in the same transaction.

The existing dashboard `AdminAuditLog` remains the request-level record.
Correlation/request IDs link the two layers.

Routine successful edits do not create Operational Events. Operational Events
represent actionable failures, drift, missing resolution, cache failure, or
migration outcomes.

Audit snapshots must redact credentials, tokens, secrets, and overly sensitive
provider payloads.

## 12. Runtime availability and caching

- Call qualification must not query Mongo once per call leg.
- RingCentral uses a cached last-known-valid route/assignment snapshot with
  bounded age and explicit invalidation after committed registry mutation.
- Call Log runs load one immutable resolver snapshot per run.
- Webhook processing uses the shared cached resolver.
- Source and CPL resolvers may use bounded read-through caches but their
  correctness cannot depend on compile-time fallback maps.
- After final cutover there is no hidden static RingCentral fallback.
- Registry unavailability produces explicit stale/unresolved states and
  Operational Events according to each workflow's failure posture.

## 13. Acceptance criteria

The initiative is complete only when:

- owner management exists for all in-scope registry entities;
- inactive records are hidden by default but explicitly selectable by the
  owner;
- Granot matching uses the approved embedded unique identity;
- Source Granularities are first-class and all automatic resolution passes
  through registry interfaces;
- owner-created companies are not rejected by static source unions/maps;
- Simple and Advanced CPL modes operate on one temporal schedule;
- active schedules are continuous and non-overlapping;
- ordinary CPL edits do not rewrite prior production Leads;
- missing CPL saves and visibly flags the Lead;
- production correction jobs are previewable, resumable, and audited;
- RingCentral validation proves account existence/access before activation;
- collection-backed routes are the only RingCentral routing authority;
- webhook and Call Log behavior agree;
- the global 120-second policy remains unchanged;
- Master Leads remains the default sheet projection;
- direct source-sheet writes require explicit validated opt-in;
- registry mutations are owner-only and transactionally audited;
- no code path touches `vantagemovershistorical`;
- migrations are idempotent and dry-run first;
- focused tests, typechecks, migration verification, and cross-repository
  contracts pass.
