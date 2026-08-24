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
  - ../vantage-admin/components/operations-registry/**
---

# Operations Registry source connections and Owner UI

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

For Granot, the ordinary and preferred connection is literal:

```text
Granot CRM Source → one Lead Source → one Feed
```

The `lead_created` policy and confirmation-text settings remain properties of
the Granot CRM Source. They do not move to the Lead Source or Feed.

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
| `crm_label` | Feed | Label Vantage sends to Granot when this Feed creates/posts a Lead |
| `granot_label` | Granot CRM Source | Label Granot sends to Vantage |
| `display_label` | RingCentral Inbound Route | Owner nickname for the phone number; never attribution logic |

“Granot label” must never be used unqualified in implementation or UI copy.
Use **What Vantage sends to Granot** for `LeadSourceGranularity.crm_label` and
**Name received from Granot** for `GranotCrmSource.granot_label`.

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

`GranotCrmSource` is already the official incoming Granot label catalog. For an
ordinary source-scoped lead it connects to:

- exactly one Lead Source (`lead_source_company`); and
- exactly one Feed through `lifecycle_routes[0].source_granularity_id`.

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
actually creates a Lead, the same resolved Lead Source ID is passed into the
texting step and supplies the company context used by the message. The texting
step must not perform a second label-to-company guess.

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

## 5. Runtime resolution contracts

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
visible in a diagnostic drawer but are not primary form controls.

For `one_feed`, the server derives `lead_model` from the selected Feed channel
and writes one `any` route. It also derives and validates the Lead Source from
the Feed; a separately submitted mismatched company/Feed pair is rejected.

Add an atomic convenience command for the new-company workflow:

```text
POST /api/v1/admin/operations-registry/lead-source-setups
```

It creates an inactive Lead Source plus one inactive default Feed in one audited
transaction. The Owner then reviews readiness/activation and creates the Granot
CRM Source connection. This is the default path for Paid Overflow-like sources;
the advanced path still permits adding multiple Feeds before connecting Granot.

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
   preview, actual on/off state, and recent sends.
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

### 7.4 New Lead Source setup

Use a short guided flow:

1. **Lead source name** — for example, Paid Overflow.
2. **How do leads arrive?** — Web forms or Inbound calls.
3. **Use one feed with the same name?** — selected by default.
4. Create the Lead Source and default Feed together.
5. **Add the name Granot sends** and connect it to that Feed.
6. Choose what happens on `lead_created`.
7. If `create_if_missing`, configure customer text; otherwise explain why text
   is unavailable.

The Owner can choose **Add separate feeds** when the company genuinely has form,
call, local, or long-distance streams. “No granularities” is therefore an Owner
experience, not a storage exception: a single-feed source still has one Feed.

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
- the activation sequence as a checklist: save number, validate, choose Feed,
  activate.

Company is derived from Feed selection and displayed read-only. Reassignment
copy must state that new calls use the new Feed immediately while old calls and
Leads keep their historical assignment.

### 7.6 Language deck

| Avoid | Use |
| --- | --- |
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
- configured SMS daily cap until enforcement exists.

The aggregate Lead Source projection translates each finding into one Owner
action and a deep link. Raw health codes stay available in advanced details.

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
