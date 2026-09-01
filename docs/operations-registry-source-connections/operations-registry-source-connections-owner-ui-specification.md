---
type: Reference
title: Operations Registry source connections and Owner UI
description: Final domain, service, route, and Owner-facing contract for Lead Sources, source feeds, sheet labels, Granot names, and RingCentral inbound numbers.
tags: [operations-registry, source-attribution, granot, ringcentral, owner-ui]
status: proposed-final
stale_after: 2026-11-24
owners: [team:main-server, team:vantage-admin]
applies_to:
  - src/models/LeadSourceCompany.ts
  - src/models/LeadSourceGranularity.ts
  - src/models/GranotCrmSource.ts
  - src/models/RingCentralInboundRoute.ts
  - src/models/RingCentralInboundRouteAssignment.ts
  - src/services/operationsRegistry/**
  - src/services/granotLifecycle/sourcePolicy.ts
  - src/services/leadMessaging/granotCreatedLead.ts
  - src/services/googleSheets/projections/**
  - src/services/ringcentral/call-log-sync.service.ts
  - ../vantage-admin/components/operations-registry/**
---

# Operations Registry source connections and Owner UI

> **Delivery:** this specification is being executed in four passes by the
> [Operations Registry source connections delivery pack](operations-registry-source-connections/README.md).
> Live status is in [`PROGRESS.md`](operations-registry-source-connections/PROGRESS.md).
> This document remains the authority; the pack sequences it and never adds
> semantics. Where the two disagree, this document wins.

## 1. Decision

The Operations Registry has one canonical attribution hierarchy:

```text
Lead Source
  └─ Feed
      ├─ accepted sheet labels
      ├─ Granot names and their reviewed destinations
      ├─ RingCentral inbound numbers
      └─ CPL schedule
```

The database terms remain **Source Company** and **Source Granularity**. The
Owner-facing terms are **Lead source** and **Feed**.

A Lead Source is the company-level attribution owner. A Feed is the exact lead
stream. Every operational connection that can create, match, price, or report a
Lead must end at a Feed, not merely at a Lead Source.

The Source Company and Feed ObjectIds are authoritative. Labels are identifiers
or display text; matching a label must resolve to those IDs before a Lead is
written. Leads retain the IDs plus label snapshots so later renames do not
rewrite history.

For Granot, the ordinary and preferred connection is literal, and it is stored
at **Feed granularity**:

```text
Granot CRM Source
  → one Lead Source  (`lead_source_company`)
  → one Feed         (`lifecycle_routes[].source_granularity_id`)
```

That persisted Feed connection is what a `lead_created` webhook uses to write
`lead_source_company` and `source_granularity_id` on a new Lead. This is how
Vantage ingests leads that did **not** arrive through a WordPress form or a
RingCentral inbound number.

The `lead_created` policy and confirmation-text settings remain properties of
the Granot CRM Source. They do not move to the Lead Source or Feed.

Customer confirmation texts identify **Vantage Movers**. They do not insert the
Lead Source's partner name. See §4.3.

## 2. Important naming correction

The proposed statement “a Lead Source Company has a sheet label and a Granot
CRM label” is too coarse for the current domain. One company can have form,
call, local, and long-distance feeds with different labels.

The final ownership is:

| Fact | Owner | Meaning |
| --- | --- | --- |
| `company_slug` | Lead Source | Immutable internal company key |
| `name` | Lead Source | Canonical business name |
| `owner_label` | Lead Source | Owner-facing display name |
| accepted sheet label | Feed through `LeadSourceLabelMapping` | Exact label read from a sheet or legacy boundary |
| `crm_label` | Feed | Label Vantage sends to Granot **and writes into the sheet Source Company column** |
| `granot_label` | Granot CRM Source | Label Granot sends to Vantage |
| `display_label` | RingCentral Inbound Route | Owner nickname for the phone number; never attribution logic |

“Granot label” must never be used unqualified in implementation or UI copy.
Use **What Vantage sends to Granot** for `LeadSourceGranularity.crm_label` and
**Name received from Granot** for `GranotCrmSource.granot_label`.

### 2.1 Correction: `owner_label` is not the sheet spelling

A working assumption in review was that the Feed's `owner_label` is both the
display name and the spelling that lands in the sheet's **Source Company**
column. **It is not.** The code is unambiguous and the distinction matters,
because one field is cosmetic and the other is a matching key that history
depends on. The sheet header is **Source Company** (`config/domain/sheets.ts`);
there is no "Lead Source" column on the Form or Call tabs.

| Field | Where it actually appears | Consequence of changing it |
| --- | --- | --- |
| `LeadSourceGranularity.crm_label` | The value Vantage posts to Granot; the value written to the sheet **Source Company** column via `crm_source_label_snapshot` (`googleSheets/projections/formLeadRow.ts:41`, `callLeadRow.ts:28`; header in `config/domain/sheets.ts`); an exact resolution identifier (`sourceResolution.ts:94`) | Reports keyed on the old spelling split; new rows carry the new spelling while old rows keep the old one. Must stay unique, case-insensitively, among **active Feeds of the same channel** (`sourceRegistry.ts:787-810`) |
| `LeadSourceGranularity.owner_label` | The option text in the admin **Source Company** filter (Filter Catalog displays `owner_label`, submits `granularity_key`); `source_granularity_label_snapshot` on each Lead; registry list ordering | Display only — **except** it becomes the sheet value as a fallback when `crm_source_label_snapshot` is empty on a Lead (`formLeadRow.ts:42`). That fallback is why the two must never be allowed to drift silently |
| `LeadSourceCompany.owner_label` | `company_label_snapshot` on Leads and in the RingCentral route snapshot; registry list ordering | Display only |
| `LeadSourceCompany.name` | Partner business name in the registry and admin editors. **Not** matched by `selectCompany`. **Not** written to the sheet. **Not** inserted into customer texts. | Internal naming only. Editing it does not change matching, sheets, or SMS. |

The Owner form must therefore label these three things distinctly and never
auto-mirror one into another after creation:

- **Lead source name** (`name`) — the partner's real name, for example Best
  Relocation. For our own records. It does not appear in customer texts.
- **Display name in Vantage** (`owner_label`) — what you will pick from filter
  dropdowns.
- **What Vantage sends to Granot** (`crm_label`) — the exact spelling that goes
  to Granot and into the sheet's **Source Company** column. Unique per channel.
  This is the Feed-level spelling, not the Lead Source name.

At creation the form may prefill `owner_label` from `name`. After the first
save, the fields are edited independently and each carries its own consequence
sentence.

### 2.2 What aliases do, exactly

Aliases are a **fallback matcher**, not a display or export field, and the two
alias lists do different jobs:

| List | Matched against | Priority |
| --- | --- | --- |
| `LeadSourceCompany.aliases` | The incoming company identifier, alongside `company_slug` (`sourceResolution.ts:190-194`) | Selects the company before any Feed is considered |
| `LeadSourceGranularity.aliases` | `fallback_alias` — the raw inbound label — only **after** exact `granularity_key`, `crm_label`, and `source_site` have all missed (`sourceResolution.ts:128-145`) | Lowest. Ties are broken by `priority`; a remaining tie is **ambiguous** and fails closed |

Two constraints the Owner form must enforce and explain:

1. **Alias matching is `trim` + `lowercase` only** — it is *not* NFKC-normalized
   and does *not* collapse internal whitespace, unlike Granot label matching
   (`granotLifecycle/sourceLabel.ts`). `"Best  Relocation"` with two spaces
   matches a Granot name and does **not** match a Feed alias. The form must
   normalize on input and warn when a pasted alias contains doubled or
   non-breaking whitespace.
2. **An alias that resolves to two active Feeds at the same priority breaks
   attribution for every lead carrying it** — the resolver returns `ambiguous`
   and refuses. The form must check the alias against all active Feeds before
   save and refuse a collision, naming both Feeds.

Aliases are the Owner's tool for tolerating a partner's inconsistent spelling
on **form and admin string inputs**. They are never the identifier a report or
an export is keyed on. They do **not** participate in Granot webhook matching
or RingCentral phone matching. Those paths have their own identifiers; see §2.3.

### 2.3 Three matching paths — do not mix them

The Owner's instinct that "the Lead Source controls matching by exact name and
aliases" is half-right and half-dangerous. It is true for **one** ingest path.
The other two ignore company aliases entirely and fail closed if you expect
them to honor a spelling you stored on the company.

| Path | What arrives | What is matched | What lands on the Lead |
| --- | --- | --- | --- |
| **Form / admin string** | A company identifier and/or a source label from a form, landing page, or admin create | Company first: `company_slug` **or** `LeadSourceCompany.aliases` (`trim` + `lowercase` only). Then Feed, in order: `granularity_key` → `crm_label` → `source_sites[]` → move type → Feed `aliases` → the company's channel default (`sourceResolution.ts`) | Resolved company + Feed IDs and current label snapshots |
| **Granot webhook** | Granot's source-name string on `lead_created`, `priority_updated`, or `booking_status_changed` | Exact `GranotCrmSource.normalized_granot_label` after NFKC + whitespace collapse + lowercase. Then the persisted `lifecycle_routes[]` ObjectId. **No** company alias, **no** Feed alias, **no** `crm_label` lookup (`sourcePolicy.ts`, `sourceLabel.ts`) | The route's Feed, and that Feed's parent Lead Source |
| **RingCentral inbound call** | The dialed queue number + the call start time | Normalized phone on a validated, ever-activated route, then the assignment interval that contains the call start. **No** string matching against company or Feed labels (`ringCentralSnapshot.ts`) | The assignment's `source_company` + `source_granularity` (company is derived from the call Feed at activate time) |

Company `name` and `owner_label` are never match keys on any of the three
paths.

Granot CRM Source and Lead Source **relate at Feed granularity**. The company
ref says who owns the source. The route's `source_granularity_id` says which
exact stream a Granot arrival becomes. A `lead_created` policy of
`create_if_missing` on that Granot name is what creates a Lead that is already
related to both IDs — this is the ingest path for partners whose leads are
born in Granot rather than on a Vantage form or a RingCentral queue.

### 2.4 What creating each entity actually does

Creating a record is not the same as turning a path on. The Owner form must
state the consequence of **create** separately from the consequence of
**activate**.

**Lead Source.** Names the attribution owner. Starts `active: false`. An
inactive company matches nothing on the form path and cannot host a live
Granot name or a live inbound-number assignment. Aliases stored here only
help form/admin string matching find this company. Nothing starts arriving.

**Feed.** Names one exact stream under that company (`channel` is immutable
once activated). Starts `active: false`. Its `crm_label` is the spelling that
will appear in the sheet **Source Company** column once leads exist. An
inactive Feed accepts no automatic attribution, cannot be a Granot route
destination that is live, and cannot receive a RingCentral assignment.

**Granot CRM Source.** Connects one exact Granot spelling to that Feed and
carries the arrival policy and the customer-text settings. This is the
non-form, non-RingCentral ingest path. Starts lifecycle-off; `lead_created`
webhooks under an unrecognized or not-yet-live name fail closed as
`source_unclassified` or are held to observation-only. Choosing
`create_if_missing` does not create leads until the activation ladder in
§3.4.2 is satisfied.

**RingCentral inbound number.** A draft with only a phone and a nickname does
**not** file calls and does **not** yet belong to a Lead Source. From the
Owner's point of view, creating the number is unfinished until three things
are true: RingCentral confirms the number exists on our account, the number
is mapped to an active **call** Feed (the Lead Source is derived from that
Feed), and the number is activated. Only then does a qualifying inbound call
create a Call Lead already related to that company and Feed.

Because the Granot name cannot be connected correctly until the Feed exists,
and because the Feed cannot exist without the Lead Source, **Lead Source and
Granot CRM Source are created in one Owner flow** (§7.4). RingCentral is a
later attachment onto an existing call Feed, not a third sibling in that
wizard.

## 3. Canonical models

### 3.1 Lead Source (`LeadSourceCompany`)

Keep:

- immutable `company_slug`;
- editable `name`, `owner_label`, and aliases;
- active/inactive lifecycle with no delete;
- default form and call Feed references;
- sheet container configuration.

Remove after a report-first migration:

- embedded `granularities[]` and its three indexes;
- compatibility default keys once no readers remain.

`lead_source_granularities` is already the first-class collection and must be
the only writable Feed catalog. The embedded array is a stale second authority.

### 3.2 Feed (`LeadSourceGranularity`)

A Feed belongs immutably to one Lead Source and has:

- immutable `granularity_key`;
- immutable `channel` (`form` or `call`);
- editable Owner display name;
- outgoing Granot label (`crm_label`);
- optional move type (`local` or `long_distance`);
- source-site identifiers and low-confidence compatibility aliases;
- active/inactive lifecycle;
- CPL schedule revision.

Activation remains fail-closed: its Lead Source must be active, exact
identifiers must not collide, CPL coverage must be valid, and an active Feed
must have a valid same-company channel default where automatic fallback exists.

### 3.3 Official sheet and legacy label mapping

Add a first-class `lead_source_label_mappings` collection. This is the item that
must move out of `config/domain/sources.ts` and other server-side label maps.

Suggested shape:

```ts
type LeadSourceLabelMapping = {
  label: string;
  normalized_label: string; // server-derived
  namespace: "sheet_lead_source" | "legacy_api_source";
  source_company: ObjectId;       // immutable, redundant integrity snapshot
  source_granularity: ObjectId;   // immutable, authoritative destination
  active: boolean;
  created_by: RegistryActorSnapshot;
  change_reason?: string;
  archived_at?: Date;
};
```

Constraints:

- unique active `{ namespace, normalized_label }`;
- selected Feed must belong to selected Lead Source;
- no fuzzy runtime match;
- correction means deactivate and replace, preserving history;
- reads resolve the Feed first and derive its Lead Source;
- static maps remain temporary, instrumented compatibility fallbacks only.

Do not put sheet labels into generic `aliases[]`. Typed mappings make the
external namespace, collision rule, destination, audit history, and eventual
removal of static maps explicit.

### 3.4 Granot name (`GranotCrmSource`)

`GranotCrmSource` is already the official incoming Granot label catalog. It is
also the policy record for Granot-born leads: `lead_created_policy` decides
whether a `lead_created` webhook may create a Lead, and `outbound_sms` decides
whether that newly created Lead may receive a confirmation text. Those two
settings live here because they describe **this Granot spelling**, not the
partner company as a whole.

For an ordinary source-scoped lead it connects to:

- exactly one Lead Source (`lead_source_company`); and
- exactly one Feed through `lifecycle_routes[0].source_granularity_id`.

The company ref and the Feed ref are both required, but the operational
relationship is at **Feed granularity**. The webhook does not "match the
company and then guess a Feed." It loads this Granot name, selects exactly one
reviewed route from observation facts, and writes that Feed — and the Feed's
parent company — onto the Lead.

This direct connection is the normal model. For example:

```text
Granot CRM Source “TBM Forms Prime”
  → Lead Source “TBM Prime Leads”
  → Feed “TBM Prime Forms”
```

The route is not a spelling convention. Its `source_granularity_id` is the
persisted foreign-key connection. The server validates that the Feed belongs to
the selected Lead Source and that its channel matches the Lead kind.

Only one current source requires a multi-Feed exception: **Best Relocation
Forms**. Granot sends one name for both move types, while Vantage pays and
deduplicates the local and long-distance streams separately. Its connection is
therefore “route by move type” to exactly two Feeds. The allowed shapes are:

1. one Call Feed (`CallLead` + `any`);
2. one Form Feed (`FormLead` + `any`); or
3. two Form Feeds: exactly one local and one long-distance.

The first two are direct one-Feed connections. In the third, move facts select
exactly one of two reviewed Feeds at runtime. Form routing without enough move
data fails closed; it does not guess.

Do not make the exceptional shape the normal Owner experience. The editor
starts with **One Feed** and offers **Different Feed for local and long-distance
moves** only when the Owner explicitly needs it.

`source_company` on `GranotCrmSource` is a legacy CSV string and must never be
shown or treated as `lead_source_company`. Retire it after CSV consumers have a
separate, explicit compatibility contract.

Incoming matching is exact after NFKC normalization, whitespace collapse, and
lowercasing. Similar spelling may produce a suggestion in the Owner form, but
the Owner must confirm the exact stored mapping. Fuzzy matching is prohibited
in webhook processing.

#### 3.4.1 Why the spelling has to be exact, in Owner words

`normalized_granot_label` carries a unique index
(`granot_crm_source_normalized_label_unique`). At webhook time the payload's
source label is normalized and looked up; **zero matches and two matches both
fail closed** (`granotLifecycle/sourcePolicy.ts:197-210`), producing
`source_unclassified` or `multiple_eligible_matches`. There is no near-match,
no trailing-character tolerance, and no per-partner special case.

The form must therefore make the exactness visible rather than implied:

- show the raw value the Owner typed and, in advanced details, the normalized
  form that will actually be matched;
- warn when normalization changes the value (trailing space, doubled space,
  smart quote, non-breaking space, mixed case) — the Owner is usually pasting
  out of Granot and these are invisible;
- refuse a duplicate normalized label at submit, naming the existing Granot name
  it collides with and linking to it;
- state the failure mode plainly: **"If the spelling in Granot differs by even
  one character, leads under that name will not be recognized here."**

#### 3.4.2 The activation ladder

A Granot name is not live because it was created. Five stored gates and two
runtime flags stand between creation and effect
(`sourcePolicy.ts:389-425`, `granotCrmSourceSemantics.ts:135-145`):

| Gate | Stored as | Owner phrasing |
| --- | --- | --- |
| Vantage-wide Granot processing is on | runtime flag | *Granot processing is on for the whole system* |
| The observation is post-activation and the processor is live | runtime mode | *We are in live mode, not shadow* |
| This name is enabled | `enabled` | *This Granot name is switched on* |
| This name is live in lifecycle processing | `lifecycle_enabled` | *This Granot name is used in live processing* |
| Its kind allows an effect | `lifecycle_disposition` | *This is one of our lead sources* |
| Its Lead Source is active | company `active` | *The lead source is active* |
| Its Feed is active | Feed `active` | *The feed is active* |
| Its arrival policy allows the effect | `lead_created_policy` | *What we do when a lead arrives* |

`lifecycle_enabled` additionally requires `enabled`, a nonempty
`lifecycle_policy_version`, and — for a source-scoped name — a normalized label,
an **active** Lead Source, and **active** Feeds on every route. That is why the
Granot name cannot be switched live before its Feed has been activated, and why
the combined setup flow in §7.4 has two commit points rather than one.

The Owner screen must render these as a checklist with the first failing gate
named, never as a single boolean labelled "enabled". Choosing a policy does not
make anything live, and the UI must not imply that it does.

#### 3.4.3 Fields the Owner never chooses, and what the server must derive

`GranotCrmSource` carries three storage fields that are required by the model
but meaningless to an Owner. The intent DTO in §6.3 omits them, so the server
must derive all three or creation fails at the database:

| Field | Constraint | Server rule |
| --- | --- | --- |
| `crm_origin` | required | default `GRANOT_CRM_DEFAULT_ORIGIN` |
| `workspace_slug` | required; **unique with `crm_origin`** | derive deterministically from the normalized Granot label; on collision, reject with a named conflict rather than silently suffixing |
| `source_company` (legacy CSV string) | required, defaults `"not_provided"` | leave at its default; **never** populate it from `lead_source_company` and never display it |

The legacy `source_company` string and the ObjectId `lead_source_company` are
different fields with confusingly similar names. Nothing in the Owner surface
may read the string one.

### 3.5 Single-Feed Lead Sources, including Paid Overflow

A Lead Source that has only one channel still receives one first-class Feed in
storage. This is required because Lead identity, duplicate detection, CPL,
Granot connections, and historical snapshots all use the Feed ID.

Paid Overflow is the canonical example:

```text
Lead Source: Paid Overflow
Feed: Paid Overflow (Form)
Granot CRM Source: Paid Overflow
Connection: Paid Overflow Granot source → Paid Overflow Form Feed
```

The Owner should not have to create three nearly identical records manually.
The **single-feed setup** creates the Lead Source and its default Feed together,
then advances directly to creating and connecting the Granot CRM Source. The UI
can present the result as one line—**Paid Overflow · Web forms**—while the
first-class Feed remains explicit in storage and advanced details.

### 3.6 RingCentral inbound number

`RingCentralInboundRoute` owns phone identity and provider validation.
`RingCentralInboundRouteAssignment` owns attribution over time.

From the Owner's point of view, **creating** an inbound queue number is not
saving a phone string. It is proving the number exists on the RingCentral
account and mapping it to a call Feed so that a later Call Lead is already
related to that Lead Source and Feed. The implementation may still be four
audited steps (save draft → validate → choose Feed → activate). The UI must
treat those as one unfinished create, not as optional extras after "created."
A draft that has not been validated and assigned files no calls.

The route’s `display_label` means only:

> A short nickname that helps you recognize this number in Vantage, such as
> “Best Relocation inbound queue.” It does not control where calls are filed.

Provider `ringcentral_queue_name` and observed target names are validation
evidence, not editable attribution.

Activation/reassignment accepts only `source_granularity_id`. The server loads
that Feed, requires it to be active and `channel: call`, derives its Lead Source,
and stores both IDs in the assignment. The client must not submit a separate
company ID. This existing behavior is the correct iron-clad contract.

Assignments are effective-dated. At call time the resolver selects the one
assignment whose interval contains the call start. Reassignment closes the old
interval and opens the new one atomically; historical Call Leads are unchanged.

#### 3.6.1 What actually starts and stops ingestion

The Owner's mental model is "activate the number and calls start coming in."
That is true, but four preconditions and one delay sit underneath it, and the UI
must state all five rather than let the Owner infer them from silence.

**A number ingests calls only while every one of these holds** — verified in
`ringCentralSnapshot.ts:142-152` and `ringCentralRegistry.ts:393-468`:

| # | Condition | Where it is enforced |
| --- | --- | --- |
| 1 | `validation_status: "valid"` — the number was found in the RingCentral account | `loadSnapshotFromDatabase` filter |
| 2 | `ever_activated: true` — it has been activated at least once | same filter |
| 3 | Exactly one assignment interval contains the call's start time | `resolveRingCentralInboundRoute` |
| 4 | The assigned Feed is active, `channel: call`, and belongs to the stored active Lead Source | `buildRingCentralRouteSnapshot:179-182` |
| 5 | `RINGCENTRAL_CALL_LOG_SYNC_ENABLED` is true | `routes/ringcentral-cron.routes.ts:54` |

**Activation preconditions** (`assertValidFreshValidation`, `loadAssignmentTarget`):

- validation must be `valid` **and no older than `RINGCENTRAL_ROUTE_VALIDATION_MAX_AGE_MS`,
  default 24 hours**. A number validated last week cannot be activated; it must
  be validated again first. This is the single most likely point of Owner
  confusion and needs explicit copy, not a generic error toast.
- the chosen Feed must be active and `channel: call`;
- its Lead Source must be active;
- the Lead Source company is **derived from the Feed** — the client never sends
  a company ID.

**Irreversible side effect of first activation:** `phone_locked` is set to
`true` and the phone number becomes immutable for the life of the record
(`ringCentralRegistry.ts:450`, model `phone_number.immutable`). The Owner must
be told this *before* the first activation, not after: a typo'd number can only
be fixed by creating a second route.

**The ingestion delay is real and must be stated.** Attribution flows through a
cached snapshot, and calls arrive through a cron:

- registry snapshot cache: **5 minutes** (`RINGCENTRAL_REGISTRY_SNAPSHOT_MAX_AGE_MS`),
  though an activation invalidates it immediately through `cacheInvalidation`;
- call-log sync cron: **every 30 minutes** (`vercel.json` →
  `/api/cron/ringcentral-call-log-sync`, `*/30 * * * *`).

So the honest Owner sentence is *"calls to this number will start being filed on
the next call-log sync, normally within 30 minutes"* — not *"immediately."*

**Calls that arrived before activation are never back-filled.** The sync window
reaches back up to 12 hours, but the assignment's `effective_from` is stamped at
activation time, and resolution requires `effective_from <= call start`. Earlier
calls in the same window resolve to nothing and are rejected as
`target_number_not_matched`. Say so on the activation screen.

**Deactivation stops ingestion; a failed re-validation stops it silently.**
Deactivating closes the open assignment in the same transaction, so new calls
stop resolving — correct and visible. But if a later validation returns
`invalid`, the number drops out of the snapshot filter and calls stop being
filed while the route still reads "active" in the list. Registry Health does
raise `registry.ringcentral_validation_failed`, but the finding does not say
what it costs. Its Owner sentence must be:

> **This number has stopped filing calls.** RingCentral no longer recognizes it.
> Calls to it are being received but not attributed to any lead source until
> validation passes again.

**The activation checklist** (§7.5) is therefore four steps with a stated gate
on each: save number → validate against RingCentral → choose the Feed calls are
filed under → activate. Step 2 must call `validateRingCentralNumberAgainstAccount`
and refuse to proceed on `invalid` or `unavailable`. Step 3 is disabled until
step 2 succeeds, and its disabled reason is shown, never hidden. The Feed
picker is the mapping: the server derives the Lead Source from that call Feed
and stores both IDs on the assignment. The Owner never types a separate
company ID.

## 4. Granot behavior and text messaging

### 4.1 Owner-facing choices

For a source-scoped Granot name, show one question:

**When Granot sends a lead under this name, what should Vantage do?**

| Stored policy | Owner copy | Result |
| --- | --- | --- |
| `observation_only` | **Watch only** | Save evidence; do not link, enrich, or create a Lead |
| `link_only` | **Use an existing lead only** | Link/enrich an eligible existing Lead; never create one |
| `create_if_missing` | **Use an existing lead, or create it if missing** | Link/enrich when found; otherwise create in the selected Feed |

This policy is independent from lifecycle activation and global runtime flags.
The UI must summarize all gates rather than imply that choosing a policy makes
it live.

### 4.2 Text messaging belongs to the Granot name

Keep `outbound_sms` on `GranotCrmSource`, not on the Lead Source. Different
incoming Granot names may have different consent evidence and creation behavior.

Enforce the model invariant:

```text
outbound_sms.enabled = true
  requires lead_created_policy = create_if_missing
```

The SMS command already rejects enabling text for any other policy. Complete
the invariant on the other write path: changing a Granot CRM Source away from
`create_if_missing` must turn its SMS setting off in the same audited mutation
and tell the Owner in the review summary. A stored source must never finish a
write with SMS enabled under `link_only` or `observation_only`.

A confirmation text is eligible only when all are true:

- messaging runtime mode is enabled;
- Granot confirmation texts are globally enabled;
- this Granot name uses `create_if_missing`;
- this event actually created a new Lead;
- texting is enabled for this Granot name;
- an accepted consent basis is attested;
- a destination phone exists.

After `lead_created` resolves the Granot CRM Source, the process obtains the
Lead Source and Feed from that persisted connection. If `create_if_missing`
actually creates a Lead, the same resolved IDs are passed into the texting
step so the send path does not perform a second label-to-company guess. That
handoff is an audit/idempotency fact. It does **not** mean the customer's
message prints the Lead Source name. The body still identifies **Vantage
Movers** (§4.3).

One Granot observation may produce at most one confirmation message. The
persisted unique observation/message identity is the idempotency boundary.
Linking or enriching an existing Lead must not send the “we got your request”
creation text.

Editing the text template increments its version and turns texting off until
the Owner reviews and re-enables it. The UI must say this before save and show
the resulting state afterward.

Current finding: `daily_cap` is persisted and returned but is not consulted by
the send path. Do not expose it to the Owner as a working safety control. Either
implement an atomic per-source/day limiter and define `0` explicitly, or remove
the field from the Owner contract.

### 4.3 The message the customer actually receives

The Owner edits a template, not a message. Four transformations sit between the
two (`leadMessaging/granotCreatedLead.ts`), and each has been a source of
surprise:

1. **`{first_name}`** renders the lead's first name, or the literal word
   `there` when it is missing. The preview must show the empty-name case, not
   only the happy one.
2. **The customer is told this is Vantage Movers.** The default template is
   hardcoded:

   > Hi {first_name}, this is Vantage Movers. We got your request and we'll
   > call you shortly to go over your move.

   That brand string is ours. It is **not** `LeadSourceCompany.name`, not
   `owner_label`, not `crm_label`, and not the Granot name. Editing the Lead
   Source name does not change any text a customer receives. The Owner preview
   must render this default as "Vantage Movers" and must never imply that the
   partner's name will appear.

   `{company}` still exists as a leftover placeholder in
   `leadMessaging/granotCreatedLead.ts`. If an Owner pastes it into a custom
   template, the send path would substitute `LeadSourceCompany.name` (then
   `owner_label`, then `"Vantage Movers"`). That is an implementation leftover,
   not the product contract. **Owner copy must not offer `{company}` as a way
   to insert the lead source.** The allowed, documented placeholder on the
   Owner form is `{first_name}` only. The server may keep accepting `{company}`
   so existing stored templates do not break; the form does not advertise it.
3. **No other placeholder is permitted.** Anything matching `{word}` outside
   `{first_name}` (and the leftover `{company}`) is rejected at save with the
   offending names listed.
4. **`Reply STOP to opt out.` is appended by the server**, and any Owner-typed
   copy of that sentence is stripped first so it cannot appear twice. The
   preview must show the appended sentence and count it against the 320-character
   limit, because the stored template is capped at 320 and the sent body is
   longer than what the Owner typed.

Two behaviors of the save path must be rendered truthfully rather than
discovered:

- **Turning texting on and editing the template in the same save leaves texting
  off.** `crmSourceOutboundSms.ts:134` computes
  `enabled = requested && !templateChanged && !basisReverted`. The request
  succeeds, the version increments, and texting is off. The form must either
  block that combination with an explanation, or state before save: *"Saving a
  new message turns texting off. You will turn it back on after reviewing the
  new message."* — and then show the resulting off state.
- **Reverting the consent basis to "not attested" turns texting off** and stamps
  `consent_basis_reverted`. Same rule: say it before, show it after.

Every one of these states is already returned in the command result. The UI's
obligation is to show the state that came back, never the state that was
requested.

## 5. Runtime resolution contracts

There are three contracts, not one resolver with three inputs. Mixing them is
how an Owner stores an alias and then wonders why a Granot webhook or a
RingCentral call ignored it. The table in §2.3 is the Owner explanation; the
subsections below are the runtime contracts.

### 5.1 Sheet or legacy input

```text
raw label
  → normalize within a declared namespace
  → exactly one active LeadSourceLabelMapping
  → active Feed
  → derive active Lead Source
  → write IDs + current label snapshots to the Lead
```

No match or multiple matches is an operational finding and fails closed for
automatic attribution. Compatibility fallback may be retained temporarily only
when it emits a durable compatibility-read event.

### 5.2 Granot observation

```text
payload source label
  → exact normalized GranotCrmSource
  → enabled + lifecycle-enabled checks
  → disposition and creation policy
  → active Lead Source
  → exactly one route selected from observation facts
  → active same-company Feed with matching channel/move type
  → effect gates
```

Every successful decision snapshots the Granot source ID, Lead Source ID, Feed
ID, route key, policy, and policy version. A later registry edit does not change
the decision already made for an observation.

### 5.3 RingCentral call

```text
called number + call start time
  → validated route
  → effective assignment interval
  → active call Feed + its Lead Source
  → qualification rules
  → Call Lead with IDs + label snapshots
```

The number and assignment are resolved from one cached snapshot for the run.
An unavailable fresh snapshot may use bounded last-known-valid data under the
existing cache policy; outside that bound it fails closed.

## 6. API contract

Keep the existing low-level mutation routes and add Owner projections that
express connections rather than collections.

### 6.1 Aggregate read model

```text
GET /api/v1/admin/operations-registry/lead-sources
GET /api/v1/admin/operations-registry/lead-sources/:id
```

Each Lead Source projection returns:

- Lead Source identity and state;
- its Feeds and readiness;
- accepted sheet/legacy labels per Feed;
- Granot names that can land in each Feed, including policy/text state;
- RingCentral numbers currently assigned to each call Feed;
- CPL readiness;
- connection health findings and deep links.

This is a read projection only. Existing audited commands remain mutation
authority.

### 6.2 Label mappings

```text
POST  /api/v1/admin/source-label-mappings
PATCH /api/v1/admin/source-label-mappings/:id/activation
GET   /api/v1/admin/source-label-mappings?source_company=&source_granularity=&namespace=
POST  /api/v1/admin/source-label-resolution/preview
```

Creation derives `normalized_label` on the server and requires a 10–1000
character Owner reason. There is no in-place destination edit; replace a bad
mapping so history remains reviewable.

### 6.3 Granot names

Retain current detail/update/activation/SMS routes and add the missing Owner
create route:

```text
POST /api/v1/admin/granot-crm-sources
```

The Owner command should accept an intent DTO, not unrestricted lifecycle
internals:

```ts
type OwnerGranotNameCommand = {
  name_received_from_granot: string;
  handling: "our_lead_source" | "referral_booking" | "watch_only";
  lead_source_id?: string;
  destination:
    | { kind: "one_feed"; feed_id: string }
    | { kind: "form_by_move_type"; local_feed_id: string; long_distance_feed_id: string }
    | null;
  when_lead_arrives: "watch_only" | "existing_only" | "create_if_missing";
  reason: string;
};
```

The server translates this into the constrained disposition, policy, and route
shape, then runs the existing semantic validator. Advanced raw fields may be
visible in a diagnostic drawer but are not primary form controls. `crm_origin`,
`workspace_slug`, and the legacy CSV `source_company` are derived per §3.4.3 —
the DTO deliberately omits them and the route must reject them if sent.

For `one_feed`, the server derives `lead_model` from the selected Feed channel
and writes one `any` route. It also derives and validates the Lead Source from
the Feed; a separately submitted mismatched company/Feed pair is rejected.

Add an atomic convenience command for the new-company workflow:

```text
POST /api/v1/admin/operations-registry/lead-source-setups
POST /api/v1/admin/operations-registry/lead-source-setups/preview
```

**One audited transaction creates the Lead Source, its default Feed, and — when
the Owner supplied one — its Granot CRM Source, all inactive.** This is the
server half of the single flow in §7.4. Creating the Granot name in the same
transaction is what makes "Lead source and Granot name are one flow" true in
storage and not merely true in the UI: either all three records exist and are
consistent, or none of them do.

```ts
type LeadSourceSetupCommand = {
  // Step 1 — the lead source
  name: string;                    // partner business name; not used in SMS
  owner_label?: string;            // defaults to name
  aliases?: string[];              // form/admin string matching only

  // Step 2 — its first feed
  channel: "form" | "call";
  feed_display_name?: string;      // defaults to a channel-appropriate name
  crm_label: string;               // what Vantage sends to Granot; unique per channel
  move_type?: "local" | "long_distance";
  feed_aliases?: string[];
  source_sites?: string[];

  // Step 3 — the Granot name, optional
  granot?: {
    name_received_from_granot: string;
    when_lead_arrives: "watch_only" | "existing_only" | "create_if_missing";
  } | null;

  reason: string;                  // 10–1000 characters
};
```

Derivations the client never supplies: `company_slug`, `granularity_key`,
`normalized_granot_label`, `crm_origin`, `workspace_slug`, the Granot
disposition, `lead_model`, and the single `any` route pointing at the created
Feed. When `granot.when_lead_arrives` is `create_if_missing`, the disposition is
source-scoped; the Feed is the created Feed by construction, so the
company/Feed consistency check cannot fail.

**Everything is created inactive, and `outbound_sms` is not written at all.**
Texting is configured only after the Granot name exists and its policy is known,
through the existing SMS command.

Validation runs completely before any write, and the command is rejected whole:

1. `reason` is 10–1000 characters.
2. Derived `company_slug` and `granularity_key` are unused.
3. `crm_label` does not collide, case-insensitively, with any **active** Feed of
   the same channel — the same rule `assertExactIdentifiersAvailable` applies at
   activation, checked early so the Owner learns it now rather than three screens
   later.
4. No alias, on either record, resolves to an existing active Feed or company;
   collisions are named on both sides.
5. `granot.name_received_from_granot` normalizes to a value no existing Granot
   name holds, and its derived `workspace_slug` is free.

The **preview** endpoint runs exactly this validation and writes nothing. It
returns the derived keys, the normalized Granot label, every collision, and the
readiness gates that will still be outstanding after creation. The wizard calls
it on the review step so the Owner sees the whole outcome before committing.

The response returns all created records plus an ordered **readiness plan** —
the remaining gates from §3.4.2 and §7.4, each with the command that satisfies
it — so the go-live screen is rendered from the server's own account of what is
missing rather than from client-side guesswork.

The advanced path is unchanged: create a Lead Source, add several Feeds, and
connect Granot names individually through the existing routes.

### 6.4 RingCentral

Keep current route endpoints. Enrich route responses so `current_assignment`
and history include Lead Source and Feed labels/keys in addition to IDs. The
admin should not need to join multiple lists merely to explain where a number
goes.

## 7. Owner UI specification

### 7.1 Information architecture

Keep the registry page but organize source configuration around **Lead sources**:

```text
Overview | Agents | Merchants | Lead sources | Granot names | Inbound numbers | Lead costs | Changes
```

The Lead Source detail is the primary explanation surface. Its header answers:

1. What is this source called?
2. Which feeds exist?
3. What external names/numbers enter each feed?
4. Is each connection ready and live?

### 7.2 Lead Source detail

Render Feed cards grouped under the Lead Source:

```text
Best Relocation

Web forms — local moves                         Live
  Sheet names accepted: Best Relocation Locals
  Vantage sends to Granot: Best Relocation Locals
  Granot names landing here: Best Relocation (create if missing; text on)
  Lead cost: ready

Inbound calls                                  Live
  Phone number: (954) 555-0142
  Number nickname: Best Relocation inbound queue
  Vantage sends to Granot: Best Relocation Inbounds
  Lead cost: ready
```

Never make the Owner infer a connection from matching spelling. Show explicit
arrows or “lands in” sentences.

### 7.3 Granot name editor

Use progressive disclosure in this order:

1. **Name received from Granot** — exact raw label, plus a read-only normalized
   preview in advanced details.
2. **What kind of source is this?** — Our lead source / Referral booking / Watch
   only.
3. **Which lead source?**
4. **Which feed does it connect to?** — one Feed picker, filtered to the selected
   Lead Source. An optional “route by move type” control reveals local and
   long-distance Feed pickers.
5. **When a lead arrives** — the three plain-language choices in §4.1.
6. **Text the customer** — only available for `create_if_missing`; show consent,
   preview (brand is **Vantage Movers**), actual on/off state, and recent sends.
   Do not offer `{company}` as a partner-name insert.
7. **Review** — one sentence summary before save:

> Granot name “Best Relocation” will use Best Relocation → Web forms — local or
> long-distance based on the move, create a Lead only when no match exists, and
> send one confirmation text when a new Lead is created.

For the common direct case, the review sentence is simpler:

> Granot name “TBM Forms Prime” connects to TBM Prime Leads → TBM Prime Forms.
> Vantage will use an existing Lead only. Customer text is off because this
> Granot name does not create Leads.

Do not show `lifecycle_disposition`, `route_key`, `lead_model`, `move_type`,
`lifecycle_policy_version`, or raw ObjectIds in the main form.

If the Owner changes **When a lead arrives** away from **Use an existing lead,
or create it if missing**, the review screen says **Customer text will be turned
off because this Granot name will no longer create Leads**.

### 7.4 New Lead Source setup — one flow, two commit points

This is the flow the Owner uses most, and the one the specification previously
under-described. It is a **single multi-step wizard**, not a sequence of
separate forms. **Lead Source and Granot CRM Source are one flow** because they
are one operational connection at Feed granularity: the company names who owns
the leads, the Feed names the exact stream, and the Granot name says which
Granot spelling lands in that stream and what Vantage should do when
`lead_created` arrives. Today's Sources tab and Granot-sources tab are
separate CRUD editors; that split is the defect this section replaces.

RingCentral inbound numbers are **not** part of this wizard. They attach later
to an existing call Feed (§7.5).

#### 7.4.1 Why a wizard, and why two commits and not one

A wizard is the right shape because the three records are not independent: the
Feed cannot exist without the Lead Source, the Granot route cannot point at a
Feed that does not exist, and — critically — **the Owner cannot supply the
Granot connection correctly unless the Feed identity is already decided.** Three
sibling forms would make the Owner carry that ordering in their head and would
leave orphaned half-configurations behind whenever they abandoned midway.

But the flow cannot be a single commit either, and it is worth being precise
about why, because the constraint is in the code and not a matter of taste:

- A Feed can only be activated once a **valid CPL schedule** exists for it
  (`setSourceGranularityActivation` → `validateCplSchedule`). CPL rates are
  their own surface with their own effective-dating; they are not a field on
  this wizard.
- A Feed can only be activated **after its Lead Source is active**, and the same
  command must make it the company's channel default (`replacement_default_id`
  must equal the Feed's own id).
- A Granot name can only be switched live **after** its Lead Source and Feed are
  both active.
- Texting can only be turned on **after** the Granot name exists with
  `create_if_missing`, and consent must be attested in the same command.

Forcing all of that into one submit would either require the wizard to own the
CPL surface, or require the server to activate things whose gates are not yet
satisfiable. Both are worse than admitting the truth to the Owner.

So the flow has **two commit points**, and the UI names them:

```text
Commit 1 — "Save as draft"        Commit 2 — "Turn it on"
one atomic transaction            a checklist of audited commands
Lead source   (inactive)          set the lead cost
Feed          (inactive)          activate the lead source
Granot name   (inactive, no SMS)  activate the feed  (becomes the default)
                                  switch the Granot name live
                                  turn on the customer text  (optional)
```

Commit 1 is `POST /operations-registry/lead-source-setups` (§6.3) — all or
nothing. Commit 2 is the existing audited commands, run one at a time from a
readiness checklist, each with its own reason and its own audit entry. Nothing
in commit 2 is batched, because each of those commands is individually
consequential and individually reversible.

Between the two, the draft is harmless: an inactive Lead Source matches nothing,
an inactive Feed accepts nothing, and an inactive Granot name is `deferred`
under `observation_only`. The Owner can leave and come back.

#### 7.4.2 The five steps

Each step states its consequence at the point of entry, not in a help panel.
The wizard is linear with back navigation; the Review step is reachable only
when every prior step validates.

**Step 1 — The lead source**

> Who sends you these leads?

| Field | Copy | Helper |
| --- | --- | --- |
| Lead source name | *Lead source name* | *The partner's real name, for example Best Relocation. For our records. Customer texts still say Vantage Movers.* |
| Display name in Vantage | *Show it as* | *What you will pick in filters and reports. Defaults to the name above.* |
| Other spellings | *Also accept these spellings* | *Used only when an incoming lead does not match exactly. Not shown anywhere and not used in reports.* |

Live validation: the derived internal key is unique; each alias is checked
against every existing active company and Feed and refuses a collision by name.

**Step 2 — How the leads arrive**

> Where do these leads come from?

Two choices, **Web forms** or **Inbound calls**, then, for web forms only,
*Do local and long-distance moves need to be tracked separately?* — off by
default, which is the single-Feed case.

| Field | Copy | Helper |
| --- | --- | --- |
| Feed name | *Name this feed* | *Defaults to "Web forms" or "Inbound calls".* |
| Granot spelling | *What Vantage sends to Granot* | *The exact label Vantage puts on every lead from this feed when it posts to Granot. **This is also the spelling that appears in the Source Company column of your sheet.** It must not match any other active feed of the same kind.* |

Live validation: `crm_label` uniqueness against active same-channel Feeds,
checked now rather than at activation.

The channel choice is worth one sentence of warning, because it is close to
irreversible: a Feed's `channel` is immutable once it has ever been activated.

**Step 3 — The Granot name** *(skippable)*

> Does Granot send you leads under a name for this source?

- **Yes** — reveals the name field and the arrival policy.
- **Not yet** — skips to Review. Leads will still arrive through the form or
  the phone number; only the Granot webhook path is left unconnected, and the
  Lead Source detail will show it as a suggested next step.

That "Not yet" branch matters: most lead sources are created from a WordPress or
landing-page submission, and their Granot name is added later. The flow must not
imply a Granot name is mandatory.

| Field | Copy | Helper |
| --- | --- | --- |
| Name received from Granot | *Name received from Granot* | *Type it exactly as Granot spells it. If it differs by even one character, leads under that name will not be recognized here.* |
| — | *(normalized preview, shown only when normalization changed the input)* | *We will match this as `best relocation`. Your entry had extra spacing.* |

**When a lead arrives** — the three §4.1 choices, in Owner language, with the
consequence under each:

- **Watch only** — *We record it as evidence. Nothing is created or changed.*
- **Use an existing lead only** — *We attach it to a lead we already have.
  We never create one.*
- **Use an existing lead, or create it if missing** — *If we have no matching
  lead, we create one in this feed. This is the only choice that can text the
  customer.*

Choosing the third reveals **Text the customer** inline — off by default, with
the template, the live preview per §4.3, and the consent attestation. The
preview shows **Vantage Movers** as the brand in the message. It is configured
here but **saved in commit 2**, because the Granot name must exist before the
SMS command can target it. The wizard says so:

> Texting is set up after the Granot name is saved. We will bring you back to
> this on the next screen.

**Step 4 — Review**

Rendered from the `lead-source-setups/preview` response, so the Owner is
reading the server's answer, not the client's optimism. It shows the derived
keys, the connection as a sentence, and the outstanding gates:

```text
You are creating

  Paid Overflow                                       lead source
    └─ Web forms                                      feed
         Vantage sends to Granot:  Paid Overflow
         Sheet Source Company column: Paid Overflow

  Granot name "Paid Overflow"                         granot name
       lands in:  Paid Overflow → Web forms
       on arrival: use an existing lead, or create it if missing
       customer text: to be set up after saving

Nothing is live yet. After saving you will:
  1. set the lead cost for this feed
  2. activate the lead source
  3. activate the feed
  4. switch the Granot name into live processing
  5. turn on the customer text
```

**Step 5 — Go live**

A persistent checklist owned by the Lead Source detail page, not by the wizard —
so it survives leaving and returning, and so an existing Lead Source that has
fallen out of readiness renders the same component.

Each row shows its gate, its state, the Owner action, and — when blocked — the
reason and what unblocks it:

| Step | Blocked until | Action |
| --- | --- | --- |
| Set the lead cost | — | opens the Lead costs surface for this Feed |
| Activate the lead source | — | audited company activation |
| Activate the feed | lead source active **and** lead cost valid | audited Feed activation; the same command makes it the channel default |
| Switch the Granot name live | feed active | audited lifecycle activation |
| Turn on the customer text | Granot name live **and** policy is create-if-missing **and** consent attested | audited SMS command |

Rows are strictly ordered and a blocked row is never merely greyed out — it
states which earlier row it is waiting on. Each action's result re-reads the
readiness plan from the server rather than optimistically ticking its own row.

#### 7.4.3 Adding separate feeds

**Add separate feeds** remains the alternate branch for a company that genuinely
has form, call, local, and long-distance streams. It repeats step 2 per Feed
before Review, and step 3's Feed picker then offers the created Feeds, including
the move-type pair. "No granularities" is an Owner experience, not a storage
exception: a single-feed source still has exactly one first-class Feed.

### 7.5 Inbound number editor

Replace **Display label** with:

**Number nickname**

_Only helps you recognize this number in Vantage. It does not decide where the
call goes._

Show a separate, prominent connection card.

**Calls to this number are filed under**

`Best Relocation → Inbound calls`

Also show:

- provider queue name under **RingCentral verified queue**;
- last validation and last observed timestamps;
- effective assignment start;
- assignment history as “From / Until / Lead source / Feed”;
- the create sequence as one unfinished job, shown as a checklist: save the
  number, prove it exists in RingCentral, choose the call Feed it is filed
  under, activate.

A number that has been saved but not validated still reads **not created**
from the Owner's point of view: RingCentral has not confirmed it, and no Call
Lead can be related to a company or Feed yet. The connection card stays empty
until a Feed is chosen.

Company is derived from Feed selection and displayed read-only. Reassignment
copy must state that new calls use the new Feed immediately while old calls and
Leads keep their historical assignment.

#### 7.5.1 Required ingestion copy

The Owner's question is always *"is this number bringing leads in yet?"* The
screen must answer it directly, from §3.6.1's facts.

**On the activation step, before the Owner confirms:**

> Once you activate this number, calls to it are read from RingCentral's call
> log and filed under **Best Relocation → Inbound calls**. The first sync
> normally runs within 30 minutes. Calls that came in before now will not be
> back-filled.
>
> Activating locks the phone number. If it is wrong, you will need to add a new
> number instead of editing this one.

**On the validation step, when validation is older than the allowed window:**

> This number was checked against RingCentral more than 24 hours ago. Check it
> again before activating.

**On an active, healthy number:**

> **Filing calls.** Last call seen 14 minutes ago. Calls to this number are
> filed under Best Relocation → Inbound calls, effective since 3 Aug 2026.

**On an active number whose validation has since failed:**

> **This number has stopped filing calls.** RingCentral no longer recognizes it.
> Calls are still arriving but are not being attributed to any lead source.
> Check it against RingCentral again.

**On deactivation:**

> New calls to this number will stop being filed. Calls already recorded and the
> leads created from them keep the lead source and feed they were filed under.

The status line must be derived from stored evidence — `validation_status`,
`validated_at`, `last_seen_in_call_log_at`, and the open assignment's
`effective_from` — and never from `active` alone, because `active` is true in
the failed-validation case above.

### 7.6 Language deck

| Avoid | Use |
| --- | --- |
| Owner label | Show it as *(Lead source)* / Name this feed *(Feed)* |
| CRM label | What Vantage sends to Granot |
| Alias | Other spellings we should accept |
| Validation status | Checked against RingCentral |
| Route assignment | Where calls to this number are filed |
| Outbound SMS | Customer text |
| Consent basis | Why we may text this customer |
| Template version | Message version |
| Sources | Lead sources |
| Granularity | Feed |
| Granot sources | Granot names |
| RingCentral | Inbound numbers |
| Display label | Number nickname |
| Operational label | Name received from Granot |
| Source company | Lead source |
| Lifecycle route | Where these leads land |
| Lifecycle activation | Use this Granot name in live processing |
| Lead created policy | When a lead arrives |
| Operational CSV enabled | Include this name in Granot imports |
| `link_only` | Use an existing lead only |
| `observation_only` | Watch only |
| `create_if_missing` | Use an existing lead, or create it if missing |
| `{company}` in a customer text | Do not offer this. Texts say Vantage Movers |
| Sheet Lead Source column | Source Company column |

## 8. Readiness and health

Add fail-closed health findings for:

- active typed label mapping whose Feed/Lead Source is missing, inactive, or
  mismatched;
- normalized label collision within a namespace;
- enabled Granot name with missing/inactive/mismatched Lead Source or Feed;
- invalid Granot route shape or duplicate normalized Granot name;
- active RingCentral route without exactly one open assignment;
- RingCentral assignment whose Feed is not an active call Feed of the stored
  Lead Source;
- active Feed without complete CPL coverage or valid channel default;
- any runtime use of the static source-label compatibility maps;
- SMS shown as on while any source-level gate is false;
- configured SMS daily cap until enforcement exists;
- **an active RingCentral route whose validation has since failed** — the number
  reads as active but has silently left the resolution snapshot, so calls are
  arriving unattributed;
- **a Feed alias, or a Lead Source alias, that resolves to more than one active
  destination** — every lead carrying it fails attribution as `ambiguous`;
- **an alias whose stored spelling differs from its own normalized form**
  (doubled, leading, trailing, or non-breaking whitespace), because alias
  matching does not collapse whitespace and such an alias can never match;
- **a Lead Source with no Feed at all**, which is the storage state a
  partly-abandoned setup leaves behind and which no current check reports.

The aggregate Lead Source projection translates each finding into one Owner
action and a deep link. Raw health codes stay available in advanced details.

Every finding's Owner sentence must state the **operational cost**, not the
inconsistency. "Route assignment targets an inactive granularity" is a
description; "calls to (954) 555-0142 are not being filed anywhere" is a
finding an Owner can act on.

## 9. Migration and rollout

1. Inventory every static source label, Feed `crm_label`/alias, sheet value,
   Granot source, RingCentral assignment, and stored Lead snapshot.
2. Report embedded `LeadSourceCompany.granularities` usage and indexes.
3. Create typed label mappings in report mode; stop on zero, multiple, or
   cross-company matches.
4. Review and apply mappings with deterministic manifests and registry audits.
5. Switch sheet/legacy resolvers to collection-first with instrumented static
   fallback.
6. Add aggregate projections and the Owner copy/UI.
7. Observe compatibility reads until they remain zero for the agreed window.
8. Remove static runtime maps, embedded granularities, and obsolete indexes in
   separately reviewed migrations.

No production mutation or SMS activation is authorized by this specification.

## 10. Acceptance criteria

- An Owner can open any Lead Source and see every Feed, accepted sheet label,
  Granot name, inbound number, and CPL state connected to it.
- Every ordinary Granot name configured as “our lead source” displays one
  explicit Lead Source → Feed connection. A reviewed move-type exception
  displays both possible Feeds and the selection rule.
- Paid Overflow-like sources use the same first-class Feed invariant but can be
  created through the single-feed setup without a separate Feed form.
- Every active inbound number displays one current Lead Source → Feed assignment
  without relying on its nickname.
- A client cannot submit inconsistent company and Feed IDs for RingCentral or
  Granot; the server derives or validates the company from the Feed.
- Runtime Granot and sheet matching is exact and deterministic; fuzzy matching
  exists only as an Owner-confirmed suggestion.
- `observation_only`, `link_only`, and `create_if_missing` behavior is tested for
  link, enrich, create, and text effects independently.
- No successful write can leave a Granot CRM Source with SMS enabled unless its
  policy is `create_if_missing`.
- A confirmation text is sent only for a newly created Lead and at most once per
  observation.
- Editing a text template visibly leaves texting off until re-enabled.
- No Owner primary surface contains `granularity`, `lifecycle`, `disposition`,
  `route_key`, `lead_model`, `policy_version`, or raw ObjectIds.
- Static label-map compatibility usage is visible in Registry Health and reaches
  zero before removal.
- A single guided flow creates a Lead Source, its Feed, and its Granot CRM
  Source, and a failure at any point in that flow leaves **none** of the three
  records behind.
- The review step of that flow is rendered from a server preview that performed
  the full validation, and every collision it can report — internal key,
  `crm_label`, alias, normalized Granot label, `workspace_slug` — is reachable
  in a test.
- The Granot name step can be skipped, and the resulting Lead Source is valid,
  usable, and shows "connect a Granot name" as an available next step.
- Go-live is a persistent, server-derived checklist: every blocked step names
  the step it is waiting on, and no step ticks itself without re-reading
  readiness from the server.
- An Owner is told, before the first activation of an inbound number, that
  activation locks the phone number and that earlier calls are not back-filled.
- An active inbound number whose validation has since failed is reported as
  having stopped filing calls, not merely as failing validation.
- The Owner form distinguishes the Feed's display name from what Vantage sends
  to Granot, and states that the latter is also the sheet's **Source Company**
  column value.
- The customer-text preview shows **Vantage Movers** as the brand, the
  empty-first-name rendering, and the server-appended opt-out sentence. It does
  not resolve or advertise `{company}` as the Lead Source name.
- Creating an inbound number is unfinished until RingCentral confirms the
  number exists and the Owner maps it to an active call Feed. A draft with only
  a phone string files no calls and writes no company or Feed on a Call Lead.
- Saving a new message body while requesting texting on results in texting off,
  and the UI says so before the save and shows the returned state after it.

## 11. Current-code findings that drive this specification

- First-class Feed records and same-company validation already exist.
- Granot CRM Sources already reference a Lead Source and constrained Feed routes.
- RingCentral assignments already store Feed and derived Lead Source with
  effective history; the DTO/UI simply does not explain it well.
- `LeadSourceCompany.granularities[]` is a duplicate embedded representation and
  is rejected by write validation.
- `config/domain/sources.ts` still contains label-to-company logic that cannot
  express Feed-level attribution and remains in compatibility consumers.
- The current Granot editor exposes implementation enums and raw route assembly.
- Paid Overflow already has a first-class `paid_overflow` Form Feed and one
  `FormLead + any` route; the simplification belongs in the Owner workflow, not
  in removing its Feed identity.
- There is no Owner `POST /admin/granot-crm-sources` route even though the
  service supports creation.
- Registry Health checks source and RingCentral integrity but does not currently
  include Granot source semantic drift.
- RingCentral route DTOs expose assignment IDs without joined Lead Source/Feed
  labels, forcing the browser to reconstruct the explanation.
- SMS `daily_cap` is not enforced by the send path.

Verified 2026-08-24 while specifying §2.1–2.2, §3.4.1–3.4.3, §3.6.1, §4.3, and
§7.4. Re-verified 2026-08-26 against matching, Granot policy, SMS, RingCentral
create, and the current Owner UI. **Reverify at implementation.**

- Form/admin matching is company-first (`company_slug` or company `aliases`),
  then Feed `granularity_key` → `crm_label` → `source_sites` → move type →
  Feed `aliases` → channel default (`sourceResolution.ts`). Company `name` and
  `owner_label` are not match keys.
- Granot matching is `normalized_granot_label` then
  `lifecycle_routes[].source_granularity_id`. It does not consult company or
  Feed aliases. `lead_created` + `create_if_missing` is the ingest path for
  leads that are not form submissions or RingCentral calls
  (`createLeadFromGranot.ts`).
- Today's Owner UI cannot create a Granot CRM Source (`POST /admin/granot-crm-sources`
  is missing; the Granot tab is update-only) and cannot create a Lead Source
  and Granot name together. That is the gap §6.3 and §7.4 close.
- RingCentral `POST .../inbound-routes` stores an unvalidated draft and does
  not accept a Feed. Validation and mapping happen on later commands
  (`ringCentralRegistry.ts`). The Owner create must present those later
  commands as unfinished create, not as optional follow-ups.

- The sheet **Source Company** column (not "Lead Source") is written from
  `crm_source_label_snapshot` first, `source_granularity_label_snapshot` second,
  and a static per-company function third (`googleSheets/projections/formLeadRow.ts:41-43`,
  `callLeadRow.ts:28-30`; headers in `config/domain/sheets.ts`). It is the
  Feed's `crm_label` at granularity level, not `LeadSourceCompany.name` or
  `owner_label` — but `owner_label` reaches the sheet whenever the CRM snapshot
  is absent, so the two are coupled by a fallback and cannot be treated as
  fully independent.
- The admin **Source Company** filter is built from Feeds: it displays
  `owner_label` and submits `granularity_key`
  (`docs/admin-filter-catalog-and-analytics-specification.md`, and the filter
  catalog handoff). Its *label* says "Source Company" while its *options* are
  Feeds, which contradicts the §7.6 deck. The deck belongs to this document; the
  filter surface belongs to the filter-catalog specification. Reconciling them is
  a cross-specification item, not a silent rename in either one.
- Alias matching is `trim` + `lowercase` only (`sourceResolution.ts:283-286`),
  while Granot label matching is NFKC + whitespace-collapse + lowercase
  (`granotLifecycle/sourceLabel.ts`). The two normalizers disagree, and an alias
  containing doubled or non-breaking whitespace can never match.
- `crm_label` uniqueness is enforced **only at Feed activation**, case-insensitively,
  against active Feeds of the same channel (`sourceRegistry.ts:787-810`). Nothing
  prevents creating a colliding draft, so the Owner meets the error at the worst
  moment unless the setup command checks it early.
- Feed activation additionally requires a valid CPL schedule and requires the
  Feed to become its company's channel default **in the same command**
  (`sourceRegistry.ts:499-554`). Company activation requires that any already-active
  channel has a valid default (`assertActiveDefaultsValid`). This ordering is
  what forces §7.4's second commit point.
- `createOrUpdateGranotCrmSource` never writes `outbound_sms`
  (`granotCrmSources.ts:259-327`), which confirms §4.2's finding: a policy change
  away from `create_if_missing` leaves texting enabled. The invariant is enforced
  only on the SMS command's own path.
- `crm_origin` and `workspace_slug` are required on `GranotCrmSource` and carry a
  unique compound index, but appear nowhere in the Owner intent DTO. Without a
  server derivation rule the Owner create route cannot succeed.
- `setGranotCrmSourceOutboundSms` computes
  `enabled = requested && !templateChanged && !basisReverted`
  (`crmSourceOutboundSms.ts:130-134`). Requesting "on" with an edited body
  returns success with texting off.
- Customer confirmation texts identify **Vantage Movers**. The default template
  hardcodes that brand (`DEFAULT_GRANOT_LEAD_CREATED_SMS_TEMPLATE` in
  `leadMessaging/granotCreatedLead.ts`). `LeadSourceCompany.name` is not used
  unless someone writes the leftover `{company}` placeholder into a custom
  template. Owner copy must not present that leftover as the product contract.
  The current Granot SMS preview in admin interpolates
  `lead_source_company_label` (which is `owner_label ?? name`) — that preview
  is wrong for the default template and must be replaced with "Vantage Movers."
- The RingCentral resolution snapshot selects routes on
  `{ ever_activated: true, validation_status: "valid" }` and never reads
  `active` (`ringCentralSnapshot.ts:148`). Deactivation stops ingestion by
  closing the assignment interval, not by the flag — and a route that later
  fails validation leaves the snapshot while still reading as active.
- Activation requires validation no older than
  `RINGCENTRAL_ROUTE_VALIDATION_MAX_AGE_MS`, default 24 hours
  (`ringCentralRegistry.ts:564-592`), and sets `phone_locked`, making the number
  permanently immutable (`:450`). Neither fact is currently surfaced to the Owner.
- Call ingestion runs on `/api/cron/ringcentral-call-log-sync` every 30 minutes
  (`vercel.json`), gated by `RINGCENTRAL_CALL_LOG_SYNC_ENABLED`, over a rolling
  window reaching back up to 12 hours. Assignments are stamped `effective_from:
  now` at activation, so calls inside that window but before activation resolve
  to nothing and are rejected as `target_number_not_matched`.
- `previewRingCentralRouteDependencies` returns a hardcoded
  `can_deactivate: true` (`ringCentralRegistry.ts:136`); it counts dependencies
  but gates nothing.
