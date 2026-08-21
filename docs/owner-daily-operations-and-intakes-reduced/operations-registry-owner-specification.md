---
type: Specification
title: Operations Registry (Owner) — lead sources, Granot source mapping, and webhook-triggered texts in three issues
description: The Owner-facing half of the Operations Registry, sized for three issues that ship alongside the reduced Daily pack. He creates a lead source and its feeds, maps the Granot label that arrives on the webhook to one of them, chooses what happens when a lead_created fires, and turns on the confirmation text for the sources that create leads. Developer vocabulary is removed from the surface, not renamed.
tags:
  - operations-registry
  - granot
  - owner-dashboard
  - lead-messaging
  - delivery
status: draft
stale_after: 2026-11-21
generated:
  by: claude-opus-5
  at: 2026-08-21T00:00:00Z
sources:
  - id: reduced-spec
    resource: ./owner-daily-reduced-specification.md
  - id: owner-copy
    resource: ./owner-daily-owner-copy.md
  - id: source-registry
    resource: ../../src/services/operationsRegistry/sourceRegistry.ts
  - id: granot-crm-sources
    resource: ../../src/services/operationsRegistry/granotCrmSources.ts
  - id: source-policy
    resource: ../../src/services/granotLifecycle/sourcePolicy.ts
  - id: create-lead-from-granot
    resource: ../../src/services/granotLifecycle/createLeadFromGranot.ts
  - id: lead-messaging
    resource: ../../src/services/leadMessaging/leadMessaging.service.ts
  - id: registry-admin
    resource: ../../../vantage-admin/components/operations-registry/registry-shell.tsx
owners: [team:main-server, team:vantage-admin]
applies_to:
  - src/services/operationsRegistry/**
  - src/services/leadMessaging/**
  - src/models/LeadSourceCompany.ts
  - src/models/GranotCrmSource.ts
  - src/models/LeadMessage.ts
  - vantage-admin/app/(dashboard)/operations-registry/**
---

# Operations Registry (Owner) — specification

## Why this document exists

Granot webhooks are arriving. Every `lead_created` that lands is matched against
a `GranotCrmSource` row by normalized label, and that row decides which Lead
Source Company and which granularity the lead belongs to — or decides nothing at
all, and the lead is dropped as `source_unclassified`.

Today the Owner cannot complete that loop. He can create a company and a
granularity through a form that asks him for `company_slug` and
`granularity_key`; he cannot create a Granot source at all; he cannot select
`create_if_missing`; and no lead created from a webhook has ever sent the
customer a text, because the only code path that texts anybody is the public
form intake.

This document carves out **three issues** that close the loop and hand the
surface to the Owner in his own words.

**Authority order.** The reduced Daily specification's §11 verification standard
and §12 standing prohibitions apply here unchanged. The copy deck's §1.1 voice
rules are binding on every string this pack ships. Where this document and the
existing registry code disagree about an invariant, **the code wins and the
disagreement is a finding to report**, not a licence to change the invariant.

**This pack does not depend on ODR-35/36/37 and they do not depend on it.** It
touches `/operations-registry`; they touch `/daily`. The only shared artifact is
the voice.

---

## 1. What ships, in one screen

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Where your leads come from                                                   │
├──────────────────────────────────────────────────────────────────────────────┤
│  Lead sources │ Granot names │ Changes                                        │
├──────────────────────────────────────────────────────────────────────────────┤
│ Best Relocation                                    Live · 3 feeds · 1 number │
│   Web form — local moves          Live    Granot calls it "Best Relocation"  │
│   Web form — long distance        Live    Granot calls it "Best Reloc LD"    │
│   Phone calls                     Live    (954) 555-0142 rings here          │
│                                                                              │
│   When Granot sends us a lead: create it if we don't have it                 │
│   Text the customer: on — "Hi {first_name}, this is Vantage Movers…"         │
└──────────────────────────────────────────────────────────────────────────────┘
```

Three things the Owner does, in the order he does them:

| # | He does | Issue |
| --- | --- | --- |
| 1 | Creates a lead source and its feeds, and sees which phone number rings into it | **ODR-38** |
| 2 | Maps the name Granot sends to one of those feeds, and chooses what happens on a lead | **ODR-39** |
| 3 | Turns on the confirmation text for a source that creates leads | **ODR-40** |

---

## 2. Vocabulary — schema to Owner

The left column never appears on `/operations-registry`. The right column is the
only thing that does. This table extends the Daily copy deck's §2 and does not
contradict it.

| System | Owner |
| --- | --- |
| `LeadSourceCompany` | **Lead source** |
| `LeadSourceGranularity` | **Feed** — one stream of leads under a lead source |
| `company_slug`, `granularity_key` | never shown; derived from the name he types |
| `channel: form` / `channel: call` | Web form / Phone calls |
| `local` / `long_distance` | Local moves / Long-distance moves |
| `crm_label` | **What Granot calls it** |
| `aliases`, `source_sites` | Other spellings we accept |
| `active: false` (never activated) | **Not live yet** |
| `active: false` (was active) | **Turned off** |
| `cpl` / `CplRatePeriod` | Lead cost |
| `RingCentralInboundRoute` | **The number that rings here** |
| `validation_status: valid` | Checked against RingCentral |
| `GranotCrmSource` | **A name Granot sends** |
| `normalized_granot_label` | never shown; powers the match |
| `lifecycle_disposition: source_scoped_lead` | These are our own leads |
| `lifecycle_disposition: referral_booking` | Someone else's lead — they book through us |
| `lifecycle_disposition: deferred` | Not decided yet — watch only |
| `lead_created_policy: observation_only` | **Just watch it** |
| `lead_created_policy: link_only` | **Match it to a lead we already have** |
| `lead_created_policy: create_if_missing` | **Match it, and create the lead if we don't have it** |
| `lifecycle_routes` | **Where these leads land** |
| `lifecycle_policy_version` | never shown; the server stamps it |
| `lifecycle_enabled` | Switched on |
| `SynchronizationDecision.outcome: policy_blocked` | Nothing happened, and here is the one reason |
| `LeadMessage` | **A text we sent** |
| `sms_consent` / consent basis | **Why we are allowed to text this person** |

Two words are banned here in addition to the copy deck's list: **granularity**
and **policy**. He has a *feed*, and he has *what happens when a lead comes in*.

---

## 3. The three decisions that shape the pack

### 3.1 The Owner never types an identifier

`company_slug` and `granularity_key` are immutable, unique, and today the Owner
types them by hand into a field labelled with their schema name — then finds out
about a collision from a `409` after submitting. Both are already derived by
`normalizeKey()` in `sourceRegistry.ts`. The Owner types **a name**; the server
shows him the derived key as a read-only consequence and checks it for a
collision *before* he submits.

**The immutability rule does not move.** He is warned, once, at create time, that
the name behind the scenes is fixed after this — because it is.

### 3.2 Activation ordering is explained, not forked

Turning a feed live is genuinely conditional today: the company must be active
(`sourceRegistry.ts:500`), a CPL schedule must validate (`:514`), no other active
feed may claim the same exact identifier (`:534`), and the feed must be selected
as its company's default for that channel *in the same command* (`:539`). Those
are real invariants that protect lead attribution.

**We do not add a "just turn it on" command that bypasses them.** We add a
**readiness projection** that names every unmet condition in the Owner's words
and offers the single action that clears it. The failure that reads
`"An active form granularity must be selected as its company's active default in
the same command."` becomes `"One more thing: pick this as the feed new web-form
leads land in."` with a button that sends `replacement_default_id`.

This is the difference between a wrapper that will drift from the invariants and
a translation that cannot.

### 3.3 The Granot label is matched, never guessed

The Owner's own observation — *"It will usually be spelled the same or very
close"* — is a **suggestion**, not a resolution rule. `resolveSourcePolicy()`
matches on exact `normalized_granot_label` equality and must keep doing so:
fuzzy matching inside the lifecycle processor would attribute a real customer's
lead to the wrong company on a typo.

So the fuzziness lives **only in the create form**, as a ranked suggestion the
Owner confirms. Once he confirms, an exact normalized label is stored and the
processor stays exact. Stated as an acceptance criterion in ODR-39 because it is
the invariant most likely to be "helpfully" broken.

---

## 4. Models

| Model | ODR-38 | ODR-39 | ODR-40 |
| --- | --- | --- | --- |
| `LeadSourceCompany` | freeze the embedded `granularities` array | — | add `outbound_sms` subdocument |
| `LeadSourceGranularity` | unchanged | unchanged | unchanged |
| `GranotCrmSource` | — | document `source_company` as legacy; no field change | — |
| `LeadMessage` | — | — | `lead_ref`, `origin`, source refs, new purpose |
| `OperationsRegistryChange` | — | — | `+ "lead_source_sms_policy"` entity type |

**`LeadSourceCompany.granularities` is dead weight.** `LeadSourceCompany.ts:66`
declares an embedded granularity array with its own `granularity_key`,
`crm_label`, `cpl`, and `inbound_phone_numbers`, and three indexes over it
(`:77–79`). `sourceRegistry.ts` creates every company with `granularities: []`
and never writes it again; every read goes to the `lead_source_granularities`
collection. It is a second, stale copy of the exact facts this pack is about to
put in front of the Owner — including a second copy of the phone number.
ODR-38 freezes it with a guard test and reports on it; dropping it is authorized
separately, after the report.

**`GranotCrmSource` carries two source-company fields.** `source_company`
(`schemaHelpers.sourceCompanyField`, a `String` defaulting to `"not_provided"`,
used by the CSV ingest path) and `lead_source_company` (an `ObjectId` ref, used
by the lifecycle). Only the second one means anything to the Owner. Neither is
renamed in this pack; the first is never rendered.

---

## 5. Migrations

All report-first, per the Daily spec §4. No implicit `autoIndex`, no production
apply authorized by this document.

| Script | Issue | What it does |
| --- | --- | --- |
| `registry-embedded-granularities-report.ts` | ODR-38 | Counts `lead_source_companies` with a nonempty `granularities` array and lists the three indexes over it. **Report only — drops nothing.** |
| *(existing)* `GRANOT_CRM_SOURCE_LIFECYCLE_INDEXES` | ODR-39 | `GranotCrmSourceSchema` sets `autoIndex: false`. The unique `normalized_granot_label` index is what stops two Granot names colliding. Verify it exists in the target database **before** the create route ships. |
| `lead-message-lead-ref.ts` | ODR-40 | Adds `lead_ref` alongside `form_lead`, backfills, verifies parity. Phase 2 — relaxing `form_lead` to optional — is a separate authorized run. |
| `lead-message-granot-idempotency-index.ts` | ODR-40 | Unique partial index on `{ observation_id, purpose }`. This is the index that stops a redelivered webhook texting a customer twice. |

---

## 6. Server contract

New files under `src/services/operationsRegistry/`:

| File | Owns | Issue |
| --- | --- | --- |
| `ownerVocabulary.ts` | The one server-side map of enum → Owner phrase, imported by projections that must echo a reason | ODR-38 |
| `leadSourceProjection.ts` | `listOwnerLeadSources()` / `getOwnerLeadSource()` — company + feeds + number + readiness, one round | ODR-38 |
| `leadSourceReadiness.ts` | `evaluateLeadSourceReadiness()` — the unmet-condition list, pure and unit-tested | ODR-38 |
| `granotSourceSuggestions.ts` | `suggestFeedsForGranotLabel()` — ranked, deterministic, create-form only | ODR-39 |
| `granotSourceIntake.ts` | `listUnmappedGranotLabels()` — labels seen on receipts with no source row | ODR-39 |
| `leadSourceSmsPolicy.ts` | The `outbound_sms` command, its attestation, and its audit | ODR-40 |

Routes, all Owner-only via `requireRegistryOwnerActor`, envelope `{ ok, data }`,
validation in `src/validation/v1/admin.validation.ts` beside the existing
registry schemas:

```text
GET   /api/v1/admin/operations-registry/lead-sources                    ODR-38
GET   /api/v1/admin/operations-registry/lead-sources/:id                ODR-38
GET   /api/v1/admin/operations-registry/lead-sources/:id/readiness      ODR-38
POST  /api/v1/admin/granot-crm-sources                                  ODR-39  (new)
GET   /api/v1/admin/granot-crm-sources/unmapped-labels                  ODR-39
POST  /api/v1/admin/granot-crm-sources/suggest-feeds                    ODR-39
PATCH /api/v1/admin/source-companies/:id/outbound-sms                   ODR-40
GET   /api/v1/admin/source-companies/:id/outbound-sms/recent            ODR-40
```

The existing eight source-company / source-granularity routes
(`v1.routes.ts:325–355`) are **reused unchanged**. This pack adds reads and one
new create; it does not re-implement a single mutation that already exists.

---

## 7. What is explicitly excluded

| Excluded | Why / who owns it |
| --- | --- |
| Fuzzy matching inside `resolveSourcePolicy` | §3.3. Permanently rejected. |
| Any relaxation of `granotCrmSourceSemantics.ts` | Its rules are what make `create_if_missing` safe to expose. |
| Bulk import of lead sources or Granot names from a sheet | Not asked for; a later issue if the count justifies it. |
| Editing CPL schedules from this surface | The existing CPL tab owns it; readiness links to it. |
| Creating or validating a RingCentral number from the lead-source page | The RingCentral tab owns it; ODR-38 links to it and reads it. |
| A general SMS template library, multi-step drips, inbound reply handling | ODR-40 ships **one** template per lead source and one trigger. |
| Email on lead creation | `GRANOT_LIFECYCLE_EMAIL_ENABLED` exists and stays off. |
| Any change to how the lifecycle processor decides | This pack changes what the Owner can *configure*, never what the processor *does* with a given configuration. |

---

## 8. Admin surface

Route group `vantage-admin/app/(dashboard)/operations-registry/`. The existing
eight-tab `RegistryShell` stays; two of its tabs are rebuilt and the rest are
untouched.

| Path | Deliverable | Issue |
| --- | --- | --- |
| `components/operations-registry/registry-copy.ts` | Every Owner-visible string in this pack | ODR-38 |
| `components/operations-registry/lead-sources/lead-source-list.tsx` | Replaces the left column of `source-companies-manager.tsx` | ODR-38 |
| `components/operations-registry/lead-sources/lead-source-detail.tsx` | Replaces `CompanyEditor` | ODR-38 |
| `components/operations-registry/lead-sources/feed-card.tsx` | Replaces `GranularityRow` | ODR-38 |
| `components/operations-registry/lead-sources/readiness-checklist.tsx` | §3.2, shared by company and feed | ODR-38 |
| `components/operations-registry/lead-sources/phone-number-panel.tsx` | The number that rings here, or how to get one | ODR-38 |
| `components/operations-registry/lead-sources/create-lead-source.tsx` | Name → derived key preview → collision check | ODR-38 |
| `components/operations-registry/granot-names/granot-name-list.tsx` | Replaces the left column of `granot-crm-sources-manager.tsx` | ODR-39 |
| `components/operations-registry/granot-names/granot-name-detail.tsx` | Replaces `GranotCrmSourceEditor` | ODR-39 |
| `components/operations-registry/granot-names/map-granot-name.tsx` | Suggestion-first create flow | ODR-39 |
| `components/operations-registry/lead-sources/customer-text-card.tsx` | On/off, editor, preview, attestation, recent sends | ODR-40 |
| `lib/api/registryLeadSources.ts` | Typed fetchers | ODR-38 → extended |

**Tab labels change; URL tokens do not.** `?tab=sources` keeps its token and
renders as **Lead sources**; `?tab=granot-sources` keeps its token and renders as
**Granot names**. Existing deep links (`?tab=...&entity=...&granularity=...`,
honoured at `source-companies-manager.tsx:46–47` and
`granot-crm-sources-manager.tsx:71`) keep working — that is a test, because the
registry health findings link into them.

---

## 9. Issue ledger

Three issues, numbered to continue past the Daily pack's ODR-37.

| Issue | Title | Depends on | Size |
| --- | --- | --- | --- |
| [**ODR-38**](issues/ODR-38.md) | Lead sources in the Owner's words — create, feed, readiness, and the number that rings | Nothing in this pack | Large |
| [**ODR-39**](issues/ODR-39.md) | Granot names — mapping, and unlocking `create_if_missing` | ODR-38 (UI shell + copy module) | Large |
| [**ODR-40**](issues/ODR-40.md) | The text we send when a webhook creates a lead | ODR-38, ODR-39 | Medium–Large |

**ODR-39's server half can start in parallel with ODR-38.** Its routes,
suggestion service, and validation change touch no file ODR-38 touches. Its UI
cannot, because it renders inside ODR-38's shell and imports its copy module.

**ODR-40 is genuinely last.** It sends a message to a real customer's phone, and
both of its gates — a live lead source and a `create_if_missing` Granot name —
are things only ODR-38 and ODR-39 let the Owner produce.

**Suggested branch:** `operations-registry-owner` in both repositories.

---

## 10. Verification standard

Inherited from the Daily pack §11, with three additions specific to this pack.

- **Every registry mutation in this pack goes through `withRegistryMutation`.**
  A `grep` for a direct `findByIdAndUpdate` on a registry collection outside a
  `mutate` callback is a review failure. The audit row is the Owner's only record
  of what he changed and why.
- **Every Owner-visible string lives in `registry-copy.ts`.** A bare string in a
  component under `lead-sources/` or `granot-names/` is a review failure, for the
  same reason the Daily pack gives: it is the only way this stays one voice.
- **No banned word reaches the DOM.** A test renders each new component against
  fixtures covering every state and asserts the rendered text contains none of:
  `granularity`, `policy`, `slug`, `disposition`, `lifecycle`, `normalized`,
  `projection`, `entity`, `revision`, `flag`, `capability`, `idempotency`,
  `snake_case identifiers`. This is mechanical and it is the acceptance criterion
  most likely to be quietly skipped.

Plus, per issue: focused `*.test.ts` beside each service; Owner-only tests at
both gates independently; redacted synthetic fixtures only; `pnpm test` and
`pnpm typecheck` in both repositories and `pnpm build` in `vantage-admin`.

---

## 11. Standing prohibitions

Everything in the Daily spec §12 applies, plus:

- **No production SMS send is authorized by this specification or by any issue in
  it.** ODR-40's live verification uses a test destination the team controls, in
  `TEST_MODE`, against the test database.
- No Granot lifecycle flag changes. `GRANOT_LIFECYCLE_LEAD_CREATION_ENABLED`
  defaults `false` and this pack does not flip it; it makes the *configuration*
  that flag gates possible to author correctly first.
- No change to how `resolveSourcePolicy`, `evaluateEffectGates`, or
  `validateGranotCrmSourceSemantics` decide anything.
- No change to the public form-lead intake path or to the consent rule that
  governs it.
</content>
</invoke>
