---
type: Specification
title: Call Lead contact provenance — operational phone locked, Granot snapshot coalesce
description: >-
  Implementation-ready contract so Call Leads keep the ingested caller as the
  operational phone, store Granot contact only on granot_contact_snapshot
  coalesced by Job Number, treat Job as authoritative after the first phone
  bind, keep HTTP Automation and extension apply on that same processor, and
  let Owner desk search find any known contact (phone first).
tags:
  - call-lead
  - granot-lifecycle
  - enrichment
  - ringcentral
  - admin-dashboard
status: proposed-final
stale_after: 2026-12-04
owners: [team:main-server, team:vantage-admin, team:extension]
applies_to:
  - src/services/granotLifecycle/leadDesiredState.ts
  - src/services/granotLifecycle/authorizedDesiredState.ts
  - src/services/granotLifecycle/synchronizeLeadFromGranot.ts
  - src/services/granotLifecycle/identity.ts
  - src/services/granotLifecycle/createLeadFromGranot.ts
  - src/services/granotLifecycle/extensionApply.ts
  - src/services/granotLifecycle/automationApply.ts
  - src/services/enrichment/callLeadEnrichment.service.ts
  - src/services/search/leadBrowseShared.ts
  - src/services/search/callLeadSearch.service.ts
  - src/services/granotLifecycle/projections.ts
  - docs/knowledge/granot-lifecycle/desired-state.md
  - docs/knowledge/granot-lifecycle/identity.md
  - docs/knowledge/services/call-lead.md
  - docs/knowledge/services/enrichment.md
sources:
  - id: glossary
    resource: ../../../CONTEXT.md
    title: Platform glossary
  - id: desired-state
    resource: ../knowledge/granot-lifecycle/desired-state.md
  - id: identity
    resource: ../knowledge/granot-lifecycle/identity.md
  - id: processor
    resource: ../knowledge/granot-lifecycle/processor.md
  - id: call-lead
    resource: ../knowledge/services/call-lead.md
  - id: enrichment
    resource: ../knowledge/services/enrichment.md
  - id: form-lead
    resource: ../knowledge/services/form-lead.md
  - id: bila
    resource: ../booking-intake-lead-attachment/booking-intake-lead-attachment-specification.md
  - id: final-spec
    resource: ../../scripts/prototypes/granot-lead-lifecycle/specs/FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md
---

# Call Lead contact provenance

> **Contract maturity: implementation-ready.** Product rules in this file win
> for Call Lead operational phone, Granot contact snapshots, Call identity
> after Job bind, shared HTTP/extension apply, and Owner desk any-known-contact
> search. File citations are evidence; reverify line numbers at implementation.
> Agents work from [`README.md`](README.md) →
> [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md) → the matching issue. Do not start
> coding from chat notes.

**Prepared:** 2026-09-04
**Repos:** `vantage-main-server` (writes, identity, preview, search). `vantage-admin` (CLCP-05 chips and Contact cards). `granot_sync_extensions_and_services` (CLCP-03 apply/preview copy; Search browse uses server paths).
**Canonical terms:** [Call Lead](../../../CONTEXT.md), [Call Qualification](../../../CONTEXT.md), [Call Lead Ingestion](../../../CONTEXT.md), [Caller Match Key](../../../CONTEXT.md), [Ingestion Origin](../../../CONTEXT.md), [Source Granularity](../../../CONTEXT.md), [Job Number](../../../CONTEXT.md), [Granot Observation](../../../CONTEXT.md), [Granot Record Link](../../../CONTEXT.md), [Synchronization Decision](../../../CONTEXT.md), [Form Submitted Contact](../../../CONTEXT.md), [Granot Contact Snapshot](../../../CONTEXT.md)

RingCentral Call Qualification creates most inbound Call Leads as **phone +
Source Granularity**. A later `priority_updated`, HTTP-automation
`lead_snapshot_apply`, or extension Follow Up apply matches that caller and
fills Job Number. Today the desired-state planner then **overwrites live
name/phone/email** on RingCentral-origin and Granot-created Call Leads. Form
(WordPress) already keeps submitted contact live and writes Granot contact
only to `granot_contact_snapshot`. This pack gives Call Leads the same
provenance split, with Job Number as the coalesce key after the first phone
bind. HTTP Automation and the extension Call Leads workspace already share
that processor door; this pack keeps them there and aligns preview/gates so
Owner guidance matches apply.

---

## 0. Authority

Read in this order. Stop and report contradictions; do not silently merge.

| Order | Authority |
| --- | --- |
| 1 | **This file** — wins on Call operational phone, Call `granot_contact_snapshot`, and Call identity after Job bind |
| 2 | [`docs/knowledge/granot-lifecycle/desired-state.md`](../knowledge/granot-lifecycle/desired-state.md), [`identity.md`](../knowledge/granot-lifecycle/identity.md), [`processor.md`](../knowledge/granot-lifecycle/processor.md) — current shipped Services; this pack changes them |
| 3 | [`docs/knowledge/services/form-lead.md`](../knowledge/services/form-lead.md) — Form snapshot pattern to copy, not rewrite |
| 4 | [`docs/knowledge/services/call-lead.md`](../knowledge/services/call-lead.md), [`enrichment.md`](../knowledge/services/enrichment.md) |
| 5 | [`docs/booking-intake-lead-attachment/booking-intake-lead-attachment-specification.md`](../booking-intake-lead-attachment/booking-intake-lead-attachment-specification.md) §2 — BILA left Call snapshot search out; this pack **does** add desk `q` (CLCP-05). Automatic suggestion still uses identity, not snapshot phone |
| 6 | [`docs/knowledge/granot-lifecycle/extension-apply.md`](../knowledge/granot-lifecycle/extension-apply.md), [`automation-apply.md`](../knowledge/granot-lifecycle/automation-apply.md) — same capture → `claimAndProcessOrPoll` door; this pack must not restore a Call enrichment bypass |
| 7 | FINAL SPEC contact/snapshot vocabulary — do not OKF-ify; do not invent a second snapshot document |
| 8 | Current repository code and tests |
| 9 | Workspace-root `CONTEXT.md` |
| 10 | This pack's issues — sequencing and scope only |

Where an issue disagrees with this file, this file wins and the issue author
fixes the issue in the same change.

---

## 1. Goal

After this pack:

1. The **operational phone** on a Call Lead is the ingested caller phone for
   the life of the row (`phone_number` / `normalized_phone_number`).
2. `ingested_contact_snapshot` stays write-once at create.
3. Qualified Granot contact is stored only on **one**
   `granot_contact_snapshot` per Call Lead, **coalesced** when later
   Observations match the same Job Number.
4. First Granot bind (no Job on the Lead yet) matches **Source Granularity +
   operational/ingested phone**, then fills Job and writes the snapshot.
5. After Job bind, later Observations match **by Job / Record Link**. A
   different Granot phone updates the snapshot and does **not** rematch, does
   **not** overwrite live phone, and does **not** conflict with another Call
   Lead that happens to have that Granot phone as its operational number.
6. Booking-intake **automatic** suggestion stays Job, else granularity +
   operational phone. Snapshot phone is **not** an automatic identity key.
7. HTTP Automation apply and extension Call Lead apply stay on the **same**
   processor (`captureChannelOperationReceipt` → `claimAndProcessOrPoll` →
   planner / identity / synchronize). Preview and the HTTP `syncable` gate
   classify snapshot contact the same way apply will write it.
8. Owner desk search (Admin browse / typeahead, intake Find / Connect,
   extension `GET /call-leads` and `POST /call-leads/search`) matches **any
   known contact**. Phone is the path that must not miss. Headline stays
   **Called** (live / ingested). Granot card is the snapshot.

Do not say “upsert” for later inbound match. Say **synchronize**.

---

## 2. Non-goals

- Minting a Call Lead on `priority_updated` or `booking_status_changed`.
- Changing Call Qualification, Duplicate Lead window, or RingCentral adoption
  candidate selection (those become more stable because live phone no longer
  moves).
- Adding Call `granot_contact_snapshot` phone to the **processor** identity
  ladder (`findCallLeadsByScopedPhone`). Desk search is a different surface.
- Enabling `GRANOT_LIFECYCLE_LEAD_WRITES_ENABLED` or any other effect flag.
- Reconstructing historical live phones that were already overwritten
  (optional backfill, not required to close the pack).
- Changing Form WordPress contact rules.
- Official Booking customer fields, Sheet column layout, or SMS copy.
- Restoring `syncCallLeadEnrichment` on HTTP or extension **apply**.
- Auto-attach on snapshot-phone-only confidence (BILA-02 high confidence
  only).

---

## 3. Current state (reverify)

Observed 2026-09-04. Line numbers move; reverify before coding.

### 3.1 Create already keeps an ingested snapshot

RingCentral and Admin/sheet create call
`callLeadCreationProvenanceFields` in
[`src/services/leads/leadIngestionProvenance.ts`](../../src/services/leads/leadIngestionProvenance.ts)
(~195–209). `ingested_contact_snapshot` is immutable
([`src/models/granotLifecycleSchemas.ts`](../../src/models/granotLifecycleSchemas.ts)
~550–568; [`CallLead.test.ts`](../../src/models/CallLead.test.ts)).

`createLeadFromGranot` already writes both ingested and
`granot_contact_snapshot` with `differs_from_ingested: false`
([`src/services/granotLifecycle/createLeadFromGranot.ts`](../../src/services/granotLifecycle/createLeadFromGranot.ts)
~641–667).

### 3.2 Planner overwrites live Call contact

[`src/services/granotLifecycle/leadDesiredState.ts`](../../src/services/granotLifecycle/leadDesiredState.ts)
`planQualifiedContact` (~350–381):

- `ingestion_origin === "wordpress_form"` → only `granot_contact_snapshot`.
- **Else** (RingCentral, `granot_lead_created`, Admin, sheet) → live
  `first_name` / `last_name` / `name` / `phone_number` /
  `normalized_phone_number` / `email`, plus planner metadata
  `last_granot_contact_change.changed_paths`.

Authority matrix in
[`docs/knowledge/granot-lifecycle/desired-state.md`](../knowledge/granot-lifecycle/desired-state.md)
states this explicitly. Test
`[AC-12] Call/Granot-created qualified contact plans current fields`
([`leadDesiredState.test.ts`](../../src/services/granotLifecycle/leadDesiredState.test.ts)
~339–367) **asserts** live name/phone overwrite. That test must invert.

`FORBIDDEN_DESIRED_PATHS` already blocks `ingested_contact_snapshot`
(`leadDesiredState.ts` ~93–106). It does not block live phone.

[`authorizedDesiredState.ts`](../../src/services/granotLifecycle/authorizedDesiredState.ts)
`GRANOT_LEAD_WRITE_PATHS` still lists live contact leaves (~16–21).
`GRANOT_CONTACT_PATHS` is those same live leaves (~38–45).
`synchronizeLeadFromGranot.ts` `buildLeadUpdate` (~513–567) writes planned
paths; `granot_contact_snapshot` gets `differs_from_ingested` +
`observation_id`; `contact_changed_paths` stamps `last_granot_contact_change`
from **live** after-image.

### 3.3 Call identity competes Job vs phone

[`src/services/granotLifecycle/identity.ts`](../../src/services/granotLifecycle/identity.ts)
`resolveCallLadder` (~784–844):

1. Active Record Link by Job.
2. Scoped `CallLead.normalized_job_no` (`call_job_no_exact`).
3. Scoped phone on **current** `normalized_phone_number` **or**
   `ingested_contact_snapshot.normalized_phone_number`
   (`findCallLeadsByScopedPhone` ~273–288). **Not**
   `granot_contact_snapshot`.
4. If Job target and phone target are **different Leads** → `conflict` /
   `job_number_conflict` (~826–834).

Test `Call Job and phone pointing at different Leads is conflict`
([`identity.test.ts`](../../src/services/granotLifecycle/identity.test.ts)
~749–771) **asserts** that conflict. After this pack that fixture must
return the Job Lead.

Service: [`docs/knowledge/granot-lifecycle/identity.md`](../knowledge/granot-lifecycle/identity.md)
Call ladder.

Locked match key remains **exact Source Granularity + normalized phone**,
never Source Company alone
([`docs/knowledge/services/call-lead.md`](../knowledge/services/call-lead.md)
Inbound Granot create and fences).

### 3.4 Webhook, HTTP apply, and extension apply already share the processor

- `priority_updated` capture:
  [`docs/knowledge/granot-lifecycle/capture.md`](../knowledge/granot-lifecycle/capture.md).
- HTTP apply (`applyAutomationPlanAction`) captures
  `granot_http_automation` and enters `claimAndProcessOrPoll`. It does
  **not** call `syncCallLeadEnrichment`:
  [`automation-apply.md`](../knowledge/granot-lifecycle/automation-apply.md),
  [`granot-http-collector.md`](../knowledge/services/granot-http-collector.md).
- Extension apply (`applyExtensionGranotItem`) captures
  `browser_extension` on the existing v1 URLs and enters the **same**
  claim/processor:
  [`extension-apply.md`](../knowledge/granot-lifecycle/extension-apply.md),
  `src/routes/extension-granot-apply.routes.ts`
  (`POST /api/v1/call-leads/enrichment/sync`,
  `POST /api/v1/call-leads/booked-reconciliation/sync`).
- Extension client:
  `granot_sync_extensions_and_services/src/workflows/call-leads/apply.ts`
  builds a raw statement (`lead_snapshot_apply` /
  `booking_action_apply`) and POSTs `{ items }`. Popup and background
  auto-sync share that apply. Preview stays on the enrichment DTOs.
- Channel and auth differ (`browser_extension` /
  `extension_session` vs `granot_http_automation` /
  `automation_owner_approval`). That is transport. Contact rules must
  not fork.
- Booking-case Decision **returns before** lead desired-state
  ([`processor.md`](../knowledge/granot-lifecycle/processor.md) Booking
  reconciliation cases). Booked never writes `job_no` onto an unmatched
  Call Lead.

### 3.5 CSV / preview still use the old enrichment matcher

[`src/services/enrichment/callLeadEnrichment.service.ts`](../../src/services/enrichment/callLeadEnrichment.service.ts)
`findBestCallLeadMatch` (~470–523):

- **Phone first** on the Granot row phone, then `job_no` only if phone
  misses. After Job bind, Granot mobile ≠ caller can **hit another Call
  Lead** whose operational phone equals that Granot mobile and never
  reach `job_no`.
- `buildUpdate` (~577–608) writes `job_no`, source, **name, email**,
  location, cubic feet. **Does not write phone or `move_date`.**
- Existing different `job_no` is not overwritten.

HTTP collector `planCallWorkflow` and the extension Call Leads preview
both call this matcher. HTTP `syncable` is
`preview.status === "updateable"` (or a receiver-agent bind). After
CLCP-01, a contact-only Granot change would still look `updateable`
because live name/email differ, or become `unchanged` if CLCP-03 removes
those assigns without teaching preview to detect snapshot diffs — and
then HTTP Automation would **not** offer the row. That is the
synchronization gap this pack closes in §5.6.

Apply rematches in identity. `expected_target` disagreement becomes
extension `conflict` (`maybeConflictOutcome`). Wrong preview target is
not “guidance only” for the Owner.

### 3.6 Owner desk Call search is live-only (must change)

[`projections.ts`](../../src/services/granotLifecycle/projections.ts)
`callLeadCandidateSearchOr` (~1622–1631): live name/email/phone + `job_no`
+ `ref_no`. Form uses `FORM_LEAD_CONTACT_*_PATHS` in
[`leadBrowseShared.ts`](../../src/services/search/leadBrowseShared.ts)
(~32–57). Connect test
[`connectLeadCandidates.test.ts`](../../src/services/granotLifecycle/connectLeadCandidates.test.ts)
~80–96 asserts Call `q` omits snapshot paths.

Admin Call browse / typeahead and extension `GET /call-leads` are
live-only ([`lead-browse.md`](../knowledge/services/lead-browse.md),
[`admin-search.md`](../knowledge/services/admin-search.md)).
`POST /api/v1/call-leads/search` is an OR lookup (not Form-style
weighted scoring) and also omits snapshots
([`call-lead-search.md`](../knowledge/services/call-lead-search.md)).

Admin `/call-leads` has no Granot chip. Contact tab is a single live
Name/Phone/Email grid
(`vantage-admin/components/operational/operational-detail-panel.tsx`).
Form already has `FormLeadContactsSection` and a `granot_contact` column.

BILA-01: “Call Lead / Granot-born Form Lead. Live fields already are the
enrichment.”
([`booking-intake-lead-attachment-specification.md`](../booking-intake-lead-attachment/booking-intake-lead-attachment-specification.md)
§2). After this pack that sentence is false. Automatic suggestion still
uses identity (Job, else operational phone). Desk `q` must find the
later Granot phone. See §7.

Checked-in `GRANOT_LIFECYCLE_LEAD_WRITES_ENABLED` remains false. Planner
and identity changes are still required so shadow plans and a later write
enablement do not overwrite phones.

---

## 4. Locked product rules

### 4.1 Operational phone

| Origin | Live `phone_number` / `normalized_phone_number` |
| --- | --- |
| `ringcentral` | Qualified caller. Never planned by Granot synchronize. |
| `granot_lead_created` | Creating Observation phone (may be absent on Job-only create). Later synchronize never changes it. |
| `vantage_admin` / `best_relocation_sheet` | Create-time contact. Later synchronize never changes it. |
| `legacy_unknown` | Whatever is stored. Synchronize still must not plan live phone. |

`ingested_contact_snapshot` is never on `changed_paths`. Do not invent a
phone on Job-only Granot create
([`call-lead.md`](../knowledge/services/call-lead.md) residual hole).

Owner `PATCH` / `correctCallLead` **may** still change live phone. Granot
lifecycle, HTTP apply, extension apply, and CSV **must not**.

### 4.2 Live name and email (locked with phone)

RingCentral Call Leads often have no name. Treat live `name` /
`first_name` / `last_name` / `email` the same as phone for **synchronize**:
they stay ingested (often empty). Qualified Granot name/email go only on
`granot_contact_snapshot`.

`createLeadFromGranot` still copies creating contact onto live fields
**and** both snapshots at mint time (already shipped). Later Observations
update the Granot card only.

Location / cubic feet / `local` / `quoted` / receiver-agent-empty-fill /
Job fill-if-missing stay as today’s planner for Priority `1` / `5` (and
agent fill at any valid Priority). This pack does not freeze move fields.

### 4.3 One coalesced Granot contact snapshot

Shape matches Form: name parts, phone, email, `differs_from_ingested`,
`observation_id`, `captured_at`. Command stamps
`differs_from_ingested` with `contactSemanticallyEqual`
(`leadDesiredState.ts` ~479+; same compare as Form).

**Coalesce** means:

- One current `granot_contact_snapshot` per Call Lead. Not an array.
- First successful qualified-contact plan (Priority `1` / `5`) writes it.
- A later temporally newer Observation for the **same Job** overwrites that
  card. Older Observations stay `stale` and do not rewrite it.
- First write usually happens on the phone-bind that also fills `job_no`.
- Job-only create may write a snapshot at mint with `differs_from_ingested:
  false` (already shipped). Later Priority `1` / `5` updates that card.

Priority gate stays Form’s: snapshot contact only on valid Priority `1` /
`5`. Job fill-if-missing may run on any temporally accepted valid
Observation. Invalid `priority_updated` still plans no contact.

### 4.4 Bind sequence

```text
RC (or Admin/sheet) create
  → operational phone + ingested snapshot; no job_no

First matched Granot Observation (usually priority_updated,
HTTP lead_snapshot_apply, or extension Follow Up apply), no job on Lead
  → identity: Source Granularity + operational/ingested phone
  → fill job_no / normalized_job_no (prefix-equivalent)
  → write granot_contact_snapshot (if Priority 1/5 + qualified contact)
  → do not change live phone/name/email

Later Observation with same Job (webhook, HTTP apply, or extension apply)
  → identity: Record Link or call_job_no_exact; skip competing phone rung
  → coalesce snapshot; live phone unchanged
```

`booking_status_changed` still **does not** synchronize the Lead. If Booked
is the first Granot event, the Call Lead still has no `job_no` until a later
`priority_updated` / apply bind. See §7.

### 4.5 Call identity after Job bind

| Situation | Outcome |
| --- | --- |
| No Job on Lead; Observation phone equals operational or ingested phone; unique in granularity | `source_scoped_contact` / linked. Bind. |
| Active Record Link with agreeing Call `lead_ref`, or unique scoped `normalized_job_no` | Job wins. **Do not run phone as a competing rung.** Do not emit `job_number_conflict` because Observation phone equals **another** Lead’s operational phone. |
| Two eligible Leads on the same Job | `conflict` / `multiple_eligible_matches` (unchanged). |
| Lead already has a **different** nonempty Job than the Observation | `job_number_conflict`. Do not overwrite Job. Do not write snapshot onto the wrong Job. Planner `conflictingJob` (`leadDesiredState.ts` ~579–586) stays. |
| Record Link exists with `lead_ref` disagreeing model/scope/Job | Hard conflict; no fall-through to phone (unchanged). |
| No Job, phone misses | `pending_match` / unmatched clock. No mint on `priority_updated`. |
| Job-only Lead (`not_applicable` convergence, no ingested phone) | Match by Job only. Do not invent operational phone. Snapshot may hold Granot phone. |

**Do not** query Call `granot_contact_snapshot` in
`findCallLeadsByScopedPhone`. Snapshots are not an automatic identity key.

Form identity is unchanged (already ORs current + ingested + Granot
contact).

### 4.6 Language

- Owner language: Caller Match Key. Implementation key: exact Source
  Granularity + normalized phone.
- Later inbound match **synchronizes**. Do not say upsert.
- Operational phone = live fields = ingested caller (after this pack).
- Granot card = `granot_contact_snapshot` only.
- Owner desk labels: **Called** (live / ingested), **Granot**,
  **Changed in Granot**. Never print snapshot field names.

---

## 5. Write-path contract

### 5.1 Desired-state planner

File: [`src/services/granotLifecycle/leadDesiredState.ts`](../../src/services/granotLifecycle/leadDesiredState.ts).

Change `planQualifiedContact` so **every** origin uses the WordPress
branch: if incoming contact is not semantically equal to
`lead.granot_contact_snapshot`, `desired.set("granot_contact_snapshot",
incoming)`. Return. Do **not** plan live contact leaves. Do **not** plan
`last_granot_contact_change.changed_paths` (command still derives
provenance when `contact_changed_paths` is empty and only the snapshot
changed — same as Form today).

Invert `[AC-12]` to: RingCentral Call Lead + Priority `1` plans
`granot_contact_snapshot`, does **not** plan `phone_number` /
`normalized_phone_number` / `name` / `email`, does **not** include
`ingested_contact_snapshot` on `changed_paths`.

Add cases:

- `granot_lead_created` Call Lead, later different Granot phone → snapshot
  only; live phone unchanged.
- Same card semantically (`+1` vs 10-digit, name peel) → `already_current`
  for contact (no snapshot rewrite).
- Priority `8` → no snapshot contact plan (agent fill may still run).

### 5.2 Authorized conversion

File: [`src/services/granotLifecycle/authorizedDesiredState.ts`](../../src/services/granotLifecycle/authorizedDesiredState.ts).

Keep `granot_contact_snapshot` on `GRANOT_LEAD_WRITE_PATHS`. Live contact
leaves may remain on the allowlist so a future Owner command can still
name them, but **this planner must not emit them**. If a test or
conversion sees `phone_number` on a synchronize plan from this pack’s
planner, that is a bug.

`contact_changed_paths` today is the intersection of `changed_paths` with
`GRANOT_CONTACT_PATHS` (live leaves). Form snapshot-only plans already
produce empty `contact_changed_paths`. Keep that. Do not invent a new
hash mode. `synchronizeLeadFromGranot` already stamps
`differs_from_ingested` when the snapshot path is present
(~526–536).

### 5.3 `synchronizeLeadFromGranot`

File: [`src/services/granotLifecycle/synchronizeLeadFromGranot.ts`](../../src/services/granotLifecycle/synchronizeLeadFromGranot.ts).

No new command. Reuse snapshot stamping. Reject (or never receive) live
phone on `changed_paths` from lifecycle plans. Extend tests that currently
expect live phone overwrite
([`synchronizeLeadFromGranot.test.ts`](../../src/services/granotLifecycle/synchronizeLeadFromGranot.test.ts)
contact fixtures ~175+).

### 5.4 `createLeadFromGranot`

File: [`src/services/granotLifecycle/createLeadFromGranot.ts`](../../src/services/granotLifecycle/createLeadFromGranot.ts).

**No behavior change required** at mint: live = ingested = creating
contact; snapshot `differs_from_ingested: false`. Confirm comments/tests
still describe later synchronize as snapshot-only. Do not start inventing
phones on Job-only create.

### 5.5 CSV Follow Up (`syncCallLeadEnrichment`)

File: [`src/services/enrichment/callLeadEnrichment.service.ts`](../../src/services/enrichment/callLeadEnrichment.service.ts)
`buildUpdate` (~577–608).

Must **not** write `phone_number` (already true). Must **not** write live
`name` / `email` after this pack (today it does). Either:

- write `granot_contact_snapshot` from the parsed CRM row (preferred, if
  the helper can stamp `differs_from_ingested` without a planner), or
- skip name/email writes and leave a warning that CSV contact is
  observation-only until lifecycle apply.

Do not restore a live-phone write. Do not overwrite a conflicting `job_no`
(already true). HTTP apply and extension apply must not start calling this
helper.

### 5.6 Shared HTTP / extension apply and preview (CLCP-03)

**Apply door (already shipped — do not regress):**

| Surface | Capture | Then |
| --- | --- | --- |
| HTTP Automation selected action | `granot_http_automation` / `automation_owner_approval` | `claimAndProcessOrPoll` |
| Extension Follow Up / Booked Jobs | `browser_extension` / `extension_session` | `claimAndProcessOrPoll` |

Same planner, identity, and `synchronizeLeadFromGranot`. Same snapshot
rules as webhook `priority_updated`. Do not import
`syncCallLeadEnrichment` or `syncBookedCallLeadReconciliation` from
`automationApply.ts` or `extensionApply.ts`. Extension
`workflows/call-leads/apply.ts` stays raw-statement `{ items }` on the
existing sync URLs.

**Preview matcher (must change):**
`findBestCallLeadMatch` / booked Path B are shared by
`planCallWorkflow` and the extension Call Leads workspace.

1. If the row has a Job Number, match **Job first** (scoped / exact
   `job_no` as today). Do not phone-first on the Granot mobile.
2. Phone only when Job is missing or Job misses — first bind. Phone
   compares **operational + ingested** only. Do **not** query
   `granot_contact_snapshot` as identity.
3. After Job bind, Granot phone ≠ caller still finds the Job Lead.
   Granot phone equal to **another** caller’s ANI must not select that
   other Lead when the row has a Job.

**`updateable` / HTTP `syncable` (must change):**
Preview `updateable` means the processor would change something the
Owner can approve: Job fill, location / cubic feet / `local`, empty
receiver bind, **or** `granot_contact_snapshot` coalesce. It must **not**
mean “live name/email/phone would change.” A contact-only Granot card
diff stays `updateable` so HTTP Automation still offers the row.
Extension apply gates (`updateable` / `unchanged` / `updated`) stay;
copy must not say live name or phone will update. Owner labels:
**Called**, **Granot**, **Changed in Granot**.

Booked-jobs Path B already prefers Job; live-phone fallback stays
operational phone. Add a test that the fallback does not read the
snapshot as identity.

`expected_target` from Job-first preview should be the Job Lead so
extension `maybeConflictOutcome` does not false-conflict after apply
identity wins on Job.

---

## 6. Identity contract (CLCP-02)

File: [`src/services/granotLifecycle/identity.ts`](../../src/services/granotLifecycle/identity.ts)
`resolveCallLadder`.

**Required change:** if `jobMatch` has a unique target (from Record Link
evaluation that already stopped, or from `call_job_no_exact` classified
linked), **return that result without computing a competing phone
conflict**. Practical implementation:

- After a unique Job/link target is known, skip
  `findCallLeadsByScopedPhone` **or** run it only for diagnostics and do
  not conflict.
- Prefer skip: one less query, no collision.

Keep:

- Phone rung when Job/link miss (first bind).
- Phone uses current + ingested only.
- Multiple Job candidates still conflict.
- Link/scope/model disagreements still conflict.
- Form ladder unchanged.

Invert `Call Job and phone pointing at different Leads is conflict`
(`identity.test.ts` ~749–771): Job Lead A + Observation phone = Lead B’s
operational phone → `linked` / `call_job_no_exact` (or
`granot_record_link` / `record_link_confirmed`) on A. Candidates must not
require B.

Add: first-bind phone hit still works when Lead A has no `job_no`.

Record Link with `lead_ref` still short-circuits before the Job/phone
compete block (`evaluateCallLink`). Do not weaken that.

---

## 7. Booking intake — what does and does not change

Automatic suggestion uses Unit 14 identity
([`booking-reconciliation.md`](../knowledge/granot-lifecycle/booking-reconciliation.md),
[`bookingReconciliation.ts`](../../src/services/granotLifecycle/bookingReconciliation.ts)
`toBookingLeadSuggestion`). Empty candidate `q` pins that suggestion
(`assembleCandidateEntries` in `projections.ts` ~1634+).

| Arrival order | Automatic discovery |
| --- | --- |
| `priority_updated` (or apply) already filled `job_no`, then Booked | Job / Record Link. Snapshot phone may differ. |
| Booked **first** (no `job_no` on Lead yet) | Granularity + operational phone. Booked **does not** write `job_no`. |
| Booked first, Granot phone ≠ ANI | No automatic match. Snapshot search cannot help (no snapshot yet). Owner Confirm Leadless / later Connect, or wait for a later Priority Update to bind. |

Automatic suggestion does **not** use snapshot phone. Ranked suggestion
+ Job / operational phone covers bind. After a prior Job bind, the Owner
must still be able to **type** the later Granot phone or name in Find
the right customer / Connect and hit the same Call Lead. That is CLCP-05
desk `q`, required.

Do not auto-attach on snapshot-phone-only confidence (BILA-02 high
confidence only).

Do not change `callLeadCandidateSearchOr` in CLCP-01–03. CLCP-05 owns
desk `q` and `known_contacts`.

---

## 8. Downstream consequences (do not “fix” unless listed)

| Surface | After this pack | Action |
| --- | --- | --- |
| Duplicate guard (`ringcentral-duplicate-guard.ts` ~83–87) | Live phone stays ANI → 90-day duplicate stays meaningful | None |
| Form Fill (`hasFormFillForCallLead`) | Still source + operational phone | None |
| RingCentral adoption (`callLeadConvergence.service.ts`) | Already queries live + ingested | None |
| Master Calls sheet (`callLeadToRow`) | Phone column stays caller | None |
| Lead Message SMS | Destination stays caller | None |
| Customer upsert at booking | `$setOnInsert` from lead phone | None |
| Admin / extension Call browse | Any-known-contact `q`; headline Called | CLCP-05 |
| Admin `/call-leads` chip + Contact cards | Called vs Granot / Changed in Granot | CLCP-05 |
| Intake / Connect Call `known_contacts` | Same as Form; headline Called | CLCP-05 |
| `POST /api/v1/call-leads/search` | OR includes snapshot phone/name/email | CLCP-05 |
| HTTP / extension preview match | Job first when row has Job; snapshot `updateable` | CLCP-03 |

---

## 9. Historical rows and flags

Leads created after provenance have `ingested_contact_snapshot`. If any
environment already applied live Granot phones (writes flag on, or old
name/email CSV), a **optional** repair is: restore live phone (and
name/email) from ingested when they differ; if current live contact
semantically differs, seed `granot_contact_snapshot`. `legacy_baseline`
without a real ingested phone cannot be reconstructed. Do not invent.
Not required to close this pack.

Do not enable Lead writes, Lead creation, Booking cases, or automation
apply flags from this pack.

No new unique Job index. Lead Job Number stays non-unique globally.

---

## 10. Tests

Minimum focused suites (issue files name the exact commands):

| Area | File | Must prove |
| --- | --- | --- |
| Planner | `leadDesiredState.test.ts` | Invert AC-12; Granot-created later phone; Priority 8; semantic equal; ingested never planned |
| Authorize | `authorizedDesiredState.test.ts` | Snapshot-only plan converts; live phone on a Call synchronize plan from this planner is rejected or never produced |
| Sync command | `synchronizeLeadFromGranot.test.ts` | Snapshot written; live phone unchanged; `differs_from_ingested` |
| Identity | `identity.test.ts` | Invert Job-vs-phone conflict; first-bind phone still works; two Jobs still conflict; Form unchanged |
| CSV / preview | `callLeadEnrichment.service.test.ts` | No live phone/name/email (or snapshot write); Job-first when row has Job; Granot phone = other ANI does not steal the Job Lead; contact-only snapshot diff is `updateable` |
| Create | `createLeadFromGranot.test.ts` | Mint still sets live = ingested; Job-only still has no invented phone |
| Desk search | `connectLeadCandidates.test.ts`, browse / admin / `callLeadSearch` tests | Call `q` hits snapshot phone; identity still omits it |

Do not skip required tests. Replica tests only if an issue touches a
transaction seam and existing replica files already cover that command.

---

## 11. Knowledge updates (CLCP-04)

After runtime issues, invoke **docs-keeper** (or edit the matching
Services) for:

- [`desired-state.md`](../knowledge/granot-lifecycle/desired-state.md) —
  Call/Granot-created qualified contact → `granot_contact_snapshot` only;
  delete “become current operational fields.”
- [`identity.md`](../knowledge/granot-lifecycle/identity.md) — Job/link
  unique ⇒ skip competing phone rung; still no Call snapshot phone query.
- [`call-lead.md`](../knowledge/services/call-lead.md) — operational phone
  immutable under Granot synchronize; snapshot coalesce by Job.
- [`enrichment.md`](../knowledge/services/enrichment.md) — CSV does not
  write live contact; preview is Job-first; apply still processor.
- [`processor.md`](../knowledge/granot-lifecycle/processor.md) — one
  sentence: matched Call synchronize does not overwrite operational
  phone.
- [`lead-browse.md`](../knowledge/services/lead-browse.md),
  [`admin-search.md`](../knowledge/services/admin-search.md),
  [`call-lead-search.md`](../knowledge/services/call-lead-search.md),
  [`projections.md`](../knowledge/granot-lifecycle/projections.md) —
  Call desk `q` is any-known-contact after CLCP-05. Headline stays Called.
- [`extension-apply.md`](../knowledge/granot-lifecycle/extension-apply.md)
  / [`automation-apply.md`](../knowledge/granot-lifecycle/automation-apply.md)
  — one sentence: same snapshot contact rule; no enrichment bypass.
- BILA spec §2 sentence “Call live fields already are the enrichment” —
  add a one-line pointer to this pack (do not reopen BILA issues).
- [`docs/index.md`](../index.md) already lists this pack after authoring.
- [`spec-hub.md`](../knowledge/granot-lifecycle/spec-hub.md) — link this
  pack; do not copy rules.

Do not invent glossary terms. Link existing ones. Owner-facing labels
stay **Called** / **Granot** / **Changed in Granot**.

---

## 12. Acceptance criteria

1. RingCentral Call Lead + Priority `1` / `5` synchronize plans and (when
   writes are tested on) persists `granot_contact_snapshot` only. Live
   phone/name/email unchanged. `ingested_contact_snapshot` unchanged.
2. Later Observation, same Job, different Granot phone: snapshot
   coalesces; live phone unchanged; identity is Job, not
   `job_number_conflict` against another caller with that Granot phone.
3. First bind still requires granularity + operational/ingested phone
   when the Lead has no Job.
4. Conflicting nonempty Jobs still conflict. Two Job candidates still
   conflict. Form WordPress rules unchanged.
5. `priority_updated` / `booking_status_changed` still never mint.
6. CSV / old enrichment never writes live phone; after CLCP-03 never
   writes live name/email.
7. HTTP Automation and extension apply stay on capture → claim. Preview
   is Job-first when the row has a Job. Contact-only snapshot diffs stay
   HTTP-approvable. Extension copy does not promise live phone/name writes.
8. Booking-intake **automatic** suggestion uses Job else operational
   phone. Desk Call `q` (intake, Connect, Admin, extension browse,
   `POST /call-leads/search`) matches live + ingested + Granot contact.
   Phone is the path that must not miss. Headline stays Called.
9. No effect flags enabled. `sourcePolicy.ts` unchanged.
10. Knowledge Services in §11 match shipped code.

---

## 13. Rollback

Revert planner, identity, preview/CSV, desk search, Admin chips, and tests.
No migration ships in the core issues. Documents revert with the same
commit or a follow-up. Checked-in Lead writes were already off; shadow
Decisions may have planned live phones — those Decisions are immutable
evidence and are not rewritten.

---

## 14. Issue map

| Issue | Owns |
| --- | --- |
| [CLCP-01](issues/CLCP-01.md) | Planner + authorize + synchronize snapshot-only contact |
| [CLCP-02](issues/CLCP-02.md) | Call identity Job-wins (skip competing phone) |
| [CLCP-03](issues/CLCP-03.md) | Shared HTTP/extension preview + CSV; apply stays processor |
| [CLCP-05](issues/CLCP-05.md) | Required: Owner desk any-known-contact + Called/Granot cards |
| [CLCP-04](issues/CLCP-04.md) | Knowledge + BILA pointer + spec-hub (last) |

Do not start CLCP-02 before CLCP-01 is `complete` (sync without Job-wins
still conflicts on the common “Granot phone = someone else’s ANI” case,
but CLCP-01 alone already stops overwriting the matched Lead’s phone).
CLCP-02 may begin in the same session after CLCP-01 tests are green.
CLCP-03 after CLCP-01 (preview/CSV must not undo the provenance rule).
CLCP-05 after CLCP-01 (desk search needs the write contract). CLCP-04
last after CLCP-02, CLCP-03, and CLCP-05.
