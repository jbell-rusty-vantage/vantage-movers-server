# ORS-2 — Granot name Owner command, SMS invariant, and texting company context

> **Contract maturity: implementation-ready.** This pass gives the Owner a way
> to *create* a Granot name through an intent DTO instead of raw lifecycle
> internals, closes the one open side of the SMS invariant, resolves the
> unenforced `daily_cap`, and proves the texting step never re-guesses a
> company. It adds no Owner UI and touches no label mapping.

## 1. Authority and required reading

- **Specification:** [`operations-registry-source-connections-owner-ui-specification.md`](../../operations-registry-source-connections-owner-ui-specification.md)
  — §2 (ownership table), §3.4, §4.1, §4.2, §5.2, §6.3 (Granot half only), §8
  (Granot findings), §11. The specification wins on every conflict.
- **Pack rules:** [`../README.md`](../README.md) standing constraints,
  [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md).
- **Lifecycle concepts:** `docs/knowledge/granot-lifecycle/source-policy.md`,
  `docs/knowledge/granot-lifecycle/processor.md`,
  `docs/knowledge/services/lead-messaging.md`.
- **Patterns to reuse, not reinvent:**
  - `src/services/operationsRegistry/granotCrmSources.ts` —
    `createOrUpdateGranotCrmSource`, `setGranotCrmSourceLifecycleEnabled`,
    `normalizeCommandLabel`, `GranotCrmSourceCommand`.
  - `src/models/granotCrmSourceSemantics.ts` — the existing semantic validator.
    The new Owner command translates *into* it; it does not replace it.
  - `src/services/operationsRegistry/crmSourceOutboundSms.ts` —
    `setGranotCrmSourceOutboundSms` and its existing guards.
  - `src/services/leadMessaging/granotCreatedLead.ts` —
    `evaluateGranotLeadSmsGates`, `sendGranotCreatedLeadConfirmation`.
  - `src/services/operationsRegistry/registryAudit.ts` for every mutation.

## 2. Objective

Make the ordinary Granot connection — one Granot name → one Lead Source → one
Feed — expressible in one audited Owner command that never accepts a
contradictory company/Feed pair, and make the exceptional move-type shape
reachable only when explicitly requested. Then close the two behavioral gaps
specification §4.2 and §11 name: the SMS invariant is enforced on only one of
two write paths, and `daily_cap` is stored, validated, and returned but consulted
by nothing.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server` only. No Admin work in this pass.
- **Branch:** the pack branch, shared with ORS-1.
- **Prerequisites:** none. Startable immediately, in parallel with ORS-1.
- **Shared-file discipline with ORS-1:** you both touch `queries/health.ts` and
  `v1.routes.ts`. Append findings at the end of the health assembly; mount your
  route adjacent to the existing `/api/v1/admin/granot-crm-sources` block at
  `v1.routes.ts:362-375`. Do not reorder or reformat existing entries.
- Ordinary checks use redacted synthetic data. Runtime reads require
  `TEST_MODE=true` and `testvantagemovers`.
- No commit, push, deploy, production flag change, production index apply, live
  payload read, or **any external send**. This pass touches the SMS path; that
  prohibition is load-bearing, not boilerplate.

## 4. Current-state evidence to verify

Observed 2026-08-24; **reverify at implementation**.

- `v1.routes.ts:362-375` mounts `GET /admin/granot-crm-sources`,
  `GET /:id`, `PATCH /:id`, `PATCH /:id/activation`, `PATCH /:id/outbound-sms`,
  `GET /:id/outbound-sms/recent`. There is **no `POST`** — the Owner cannot
  create a Granot name, though `createOrUpdateGranotCrmSource` supports it.
- `src/routes/granot-crm-sources.routes.test.ts` exists with **no sibling routes
  file**; these routes are mounted inline in `v1.routes.ts`. Follow that, or
  extract deliberately and say so — do not half-extract.
- `GranotCrmSource.ts` carries `lifecycle_disposition` (:146),
  `lead_created_policy` (:152), `lead_source_company` (:158),
  `lifecycle_routes[]` (:162) with `route_key` (:105) and
  `source_granularity_id` (:116), the legacy CSV `source_company` (:136), and an
  index on `lifecycle_routes.source_granularity_id` (:44). A pre-validate hook
  (~:189-214) runs the semantic validator and calls `this.invalidate(...)`.
- `crmSourceOutboundSms.ts:111` **already rejects** enabling SMS when
  `before.lead_created_policy !== "create_if_missing"`. Line ~134 already forces
  `enabled = command.enabled && !templateChanged && !basisReverted`, and ~143
  increments `template_version` on a template change. **The template-version
  half of §4.2 already works — verify it, do not rebuild it.**
- **The gap:** `createOrUpdateGranotCrmSource` can change
  `lead_created_policy` away from `create_if_missing` **without** touching
  `outbound_sms.enabled`. That is the invariant hole this pass closes.
- `daily_cap`: written at `v1.routes.ts:1171` and
  `crmSourceOutboundSms.ts:160,276`, validated at `admin.validation.ts:334`
  (`int, 0..10_000`), defaulted `0` at `GranotCrmSource.ts:95`. **No send path
  reads it.** Confirm with a fresh repository-wide search before acting.
- `sendGranotCreatedLeadConfirmation` (`granotCreatedLead.ts:110`) already takes
  `lead_source_company_id` and loads the company name from it (~:220-237). Trace
  the caller in `src/services/granotLifecycle/` to confirm whether that ID comes
  from the resolved Granot source connection or from a second label lookup —
  **this is the §4.2 claim you must verify, not assume.**
- `queries/health.ts` emits no Granot CRM Source semantic finding today.

## 5. Locked decisions and invariants at risk

- **One Feed is the normal shape.** The Owner command defaults to `one_feed`.
  `form_by_move_type` is reachable only when explicitly submitted, and only for
  Form Feeds — exactly one local and one long-distance. Best Relocation Forms is
  the single current instance and it is an exception, not a template.
- **The server derives; the client never asserts.** For `one_feed`, the server
  derives `lead_model` from the selected Feed's channel, derives the Lead Source
  from the Feed, and writes one `any` route. A submitted company that disagrees
  with the Feed's company is **rejected**, not corrected. Same rule the
  RingCentral path already enforces.
- **The intent DTO is a translation layer, not a second authority.** It
  translates to disposition + policy + routes and then runs the **existing**
  semantic validator in `granotCrmSourceSemantics.ts`. If the two ever disagree,
  the validator wins and the translation is wrong.
- **`outbound_sms` stays on `GranotCrmSource`.** It never moves to the Lead
  Source or the Feed. Different incoming names carry different consent evidence.
- **No successful write may finish with SMS enabled under `link_only` or
  `observation_only`** — on *any* path, including the one that changes the
  policy. Enforce it inside the same audited mutation, not as a follow-up write.
- **Form routing without enough move data fails closed.** It does not guess a
  move type, and it does not fall back to either Feed.
- **Exact matching after NFKC, whitespace collapse, and lowercasing.** Fuzzy
  matching is prohibited in webhook processing. A similar-spelling suggestion may
  be *offered* to an Owner but must be confirmed as an exact stored mapping.
- **One observation produces at most one confirmation message.** The persisted
  observation/message identity is the idempotency boundary. Linking or enriching
  an existing Lead sends nothing.
- Policy choice is not activation. The response and every summary must state all
  gates, never imply that choosing `create_if_missing` makes texting live.

## 6. Deliverables and exact contract

### 6.1 Owner create command

```ts
export type OwnerGranotNameCommand = {
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

New `src/services/operationsRegistry/ownerGranotNames.ts`:

```ts
export async function createGranotNameFromOwnerIntent(
  command: OwnerGranotNameCommand,
  actor: RegistryActorContext,
): Promise<GranotCrmSourceRecord>;
```

Translation table — implement exactly this, and derive nothing else:

| Owner field | Stored field |
| --- | --- |
| `handling: "our_lead_source"` | source-scoped `lifecycle_disposition` |
| `handling: "referral_booking"` | referral disposition |
| `handling: "watch_only"` | observation disposition; `destination` must be `null` |
| `when_lead_arrives: "watch_only"` | `lead_created_policy: "observation_only"` |
| `when_lead_arrives: "existing_only"` | `lead_created_policy: "link_only"` |
| `when_lead_arrives: "create_if_missing"` | `lead_created_policy: "create_if_missing"` |
| `destination.kind: "one_feed"` | one route, `route_key` `any`, `lead_model` derived from the Feed's channel |
| `destination.kind: "form_by_move_type"` | two `FormLead` routes keyed by move type |

Validation order, all before any write:

1. `name_received_from_granot` normalizes to a value not already held by an
   existing Granot name (exact, after NFKC + collapse + lowercase).
2. `reason` is 10–1000 characters.
3. `handling: "watch_only"` ⇒ `destination` is `null` and
   `when_lead_arrives` is `"watch_only"`.
4. Every referenced Feed exists, is active, and belongs to `lead_source_id` —
   or `lead_source_id` is omitted and derived from the Feed. A submitted
   mismatch is rejected naming both sides.
5. `form_by_move_type` ⇒ both Feeds are `channel: form`, one `local`, one
   `long_distance`, both in the same Lead Source, and they are not the same Feed.
6. `one_feed` ⇒ `lead_model` derived from the Feed's channel; the client cannot
   supply it.
7. The assembled document passes `granotCrmSourceSemantics.ts` unchanged.

New source is created **inactive**, with SMS off. Activation stays the existing
separate audited command. Route:

```text
POST /api/v1/admin/granot-crm-sources
```

Validation in `src/validation/v1/admin.validation.ts` alongside the existing
Granot schemas; unknown keys reject. Raw lifecycle fields are **not** accepted by
this route — they keep their existing `PATCH` path for diagnostics.

### 6.2 Close the SMS invariant on the update path

In `createOrUpdateGranotCrmSource`, when a write changes
`lead_created_policy` away from `create_if_missing` on a source whose
`outbound_sms.enabled` is `true`:

- set `outbound_sms.enabled = false` **in the same audited mutation**;
- stamp `deactivated_at` and a `deactivation_reason` naming the policy change;
- return the fact in the command result so the caller can render
  ORS-4's review-screen sentence: *"Customer text will be turned off because
  this Granot name will no longer create Leads."*

This is a single atomic write. Two sequential writes leave a window where a
stored source has SMS enabled under `link_only`, which acceptance criterion 8
forbids.

### 6.3 Resolve `daily_cap`

Specification §4.2: implement an atomic per-source/day limiter **or** remove the
field from the Owner contract. **Default decision: remove it from the Owner
contract** — see the open question in [`../PROGRESS.md`](../PROGRESS.md). If the
Owner has not answered by the time you start, proceed with removal.

Removal means: drop it from `OwnerOutboundSmsView`, from the accepted request
body in `admin.validation.ts:334`, and from the write in `v1.routes.ts:1171`.
**Leave the persisted field on the model** — deleting stored data is a separate,
separately reviewed migration. Add the health finding in §6.5 so any source with
a non-zero stored cap stays visible until that migration runs.

If the Owner instead answers "enforce": the limiter must be atomic
per-source/day, `0` must be defined explicitly (unlimited or blocked — say
which), and it needs its own tests. That is materially more work; re-scope with
the Owner before absorbing it into this pass.

### 6.4 Texting company context and idempotency

Verify, and fix if the evidence in §4 does not hold:

- After `lead_created` resolves the `GranotCrmSource`, the Lead Source and Feed
  come from that **persisted connection**.
- When `create_if_missing` actually creates a Lead, that same resolved Lead
  Source ID is what reaches `sendGranotCreatedLeadConfirmation`. The texting
  step performs **no second label-to-company lookup**.
- A link or enrich of an existing Lead sends nothing.
- One observation yields at most one message, bounded by the persisted
  observation/message identity — not by an in-process guard.

Also add the §5.2 decision snapshot: every successful decision records the
Granot source ID, Lead Source ID, Feed ID, route key, policy, and policy
version, so a later registry edit cannot retroactively change a decision already
made. If some of these are already snapshotted, extend the existing record
rather than adding a parallel one, and say which in your report.

### 6.5 Health findings

Append to `queries/health.ts`:

| Code | Condition |
| --- | --- |
| `registry.granot_source_destination_invalid` | Enabled Granot name whose Lead Source or Feed is missing, inactive, or mismatched |
| `registry.granot_source_route_shape_invalid` | Route shape violates §3.4 (wrong count, wrong channel, duplicate move type, non-Form move-type routing) |
| `registry.granot_source_label_collision` | Two sources share a normalized `granot_label` |
| `registry.granot_sms_gate_inconsistent` | SMS shown as on while any source-level gate is false |
| `registry.granot_sms_daily_cap_configured` | A stored non-zero `daily_cap` while enforcement does not exist |

## 7. Explicitly out of scope

- Everything in `lead_source_label_mappings`, `sourceResolution.ts`, and
  `config/domain/sources.ts` — ORS-1.
- The aggregate Lead Source projection, `lead-source-setups`, and RingCentral —
  ORS-3.
- All Admin/UI work, including the Granot editor's progressive disclosure and
  the review sentence — ORS-4. This pass ships the server fact the sentence
  reports; it does not render it.
- Retiring the legacy CSV `source_company` string. Specification §3.4 defers it
  until CSV consumers have their own compatibility contract. Report its
  consumers; change nothing.
- Enabling SMS, changing any lifecycle activation flag, or sending any message.
- Migrating stored `daily_cap` values out of the database.

## 8. Flags and runtime posture

- **No new flag.** The Owner create route is gated by Owner authorization.
- Every checked-in lifecycle effect flag stays false. All new behavior must be
  correct with every effect flag false — that is the day-one posture and it is a
  test, not a caveat.
- Messaging runtime mode stays off. SMS tests assert gate *decisions*, never a
  dispatch.

## 9. Migration and indexes

No new collection. No new index expected — `lifecycle_routes.source_granularity_id`
already exists at `GranotCrmSource.ts:44`. If the health sweep in §6.5 needs an
index to run bounded, add it report-first and justify it in the report.

A **report-only** script, `scripts/migrations/granot-source-semantic-drift.ts`,
run as `pnpm migration:granot-source-semantic-drift`: list every existing Granot
name that would fail the §6.5 findings today. **Report only. Fix nothing
automatically** — each row is an Owner decision.

## 10. Acceptance criteria

- [ ] `POST /api/v1/admin/granot-crm-sources` creates an inactive, SMS-off
      source from a valid `one_feed` intent, and the stored document has exactly
      one route with `route_key` `any` and a `lead_model` derived from the Feed.
- [ ] Submitting `lead_source_id` that disagrees with the Feed's Lead Source is
      rejected, and the error names both.
- [ ] Submitting `lead_model` or `route_key` directly on the Owner route is
      rejected as an unknown key.
- [ ] `form_by_move_type` with two Call Feeds, with two local Feeds, with the
      same Feed twice, or with Feeds from different Lead Sources is rejected —
      four separate named tests.
- [ ] `handling: "watch_only"` with a non-null `destination` is rejected.
- [ ] A duplicate normalized `name_received_from_granot` is rejected.
- [ ] Changing an existing source's policy from `create_if_missing` to
      `link_only` while SMS is enabled leaves SMS **off**, stamps a
      `deactivation_reason`, and reports the change — in one mutation. Asserted
      by reading the stored document, not the command result.
- [ ] No write path can produce a stored source with `outbound_sms.enabled` true
      and a policy other than `create_if_missing`. Proven by exercising **both**
      the SMS route and the update route.
- [ ] Editing a template increments `template_version` and leaves `enabled`
      false until explicitly re-enabled. (Verify the existing behavior; regression
      test it.)
- [ ] `daily_cap` no longer appears in the Owner request body or view, the
      stored field is untouched, and a stored non-zero cap raises
      `registry.granot_sms_daily_cap_configured`.
- [ ] `observation_only`, `link_only`, and `create_if_missing` are tested
      independently for link, enrich, create, and text effects — twelve
      outcomes, not one combined test.
- [ ] A `create_if_missing` observation that creates a Lead passes the **resolved**
      Lead Source ID to the texting step; a test asserts no second
      label-to-company lookup occurs.
- [ ] A `link_only` observation that enriches an existing Lead sends nothing.
- [ ] Replaying one observation twice produces at most one message, enforced by
      the persisted identity.
- [ ] Every successful decision snapshots Granot source ID, Lead Source ID, Feed
      ID, route key, policy, and policy version; editing the registry afterwards
      does not alter the snapshot.
- [ ] Each of the five health findings has a fixture that raises it and a
      fixture that does not.
- [ ] Every mutation appears in the registry audit trail with actor and reason.

## 11. Required tests and commands

```bash
pnpm test
pnpm typecheck
pnpm migration:granot-source-semantic-drift          # report mode only
```

Focused tests:

- `src/services/operationsRegistry/ownerGranotNames.test.ts` — the translation
  table row by row, and every rejection in §6.1's validation order.
- `src/services/operationsRegistry/granotCrmSources.test.ts` — extend with the
  policy-change-turns-SMS-off case, asserted on the stored document.
- `src/services/operationsRegistry/crmSourceOutboundSms.test.ts` — regression on
  the existing enable-guard and template-version behavior.
- `src/services/granotLifecycle/processor.test.ts` (or the nearest existing
  suite) — the twelve policy × effect outcomes and the single-message idempotency
  replay.
- `src/services/leadMessaging/granotCreatedLead.test.ts` — the resolved-company
  assertion and the no-second-lookup assertion.
- `src/services/operationsRegistry/queries/health.test.ts` — the five findings.
- Route test — Owner-only gating, unknown-key rejection, error-envelope parity
  with the adjacent Granot routes.

Zero-send proof: run the full suite and assert no Twilio adapter dispatch
occurred. `twilioAdapter.ts` must be stubbed, and the stub asserted un-called in
the policy tests.

## 12. Live/staging verification

Preview deploy against `TEST_MODE` and `testvantagemovers`. Verify: creating a
Granot name through the Owner route; the rejection of a mismatched company/Feed
pair; the policy change turning SMS off; the drift report listing existing
sources. Capture deployment ids.

**No production deploy, no live payload read, no external send, no SMS
activation.**

## 13. Rollback

Ordered: unmount `POST /admin/granot-crm-sources` first — that removes all new
reachability. Then revert the `daily_cap` contract change (the stored field was
never touched, so this is a pure API revert). The SMS invariant fix is a
tightening, not a behavior change for correct data: leave it. New sources created
during the pass exist only on the test database.

## 14. Required completion handoff

Report: files added and changed; the translation table as implemented; the
verdict on §4's `daily_cap` search and what you did about it; whether the
texting step already received the resolved company ID or you had to fix it, with
the call chain; whether the decision snapshot already existed or was extended;
the drift-report output verbatim; the twelve policy × effect outcomes as a table;
proof the Twilio stub was never called; test and typecheck output; preview
deployment ids; and explicit confirmation that no SMS was enabled, no lifecycle
flag changed, and no message was sent.

Then update [`../PROGRESS.md`](../PROGRESS.md): tick §3.4, §4.1, §4.2 (both
rows), §5.2, §6.3 (Granot half), §8 (Granot findings), and criteria 5, 6, 7, 8,
9, 10; set ORS-2 `complete`; and if ORS-1 is already `complete`, move ORS-3 to
`ready`.

**Unblocks:** ORS-3 (jointly with ORS-1).
