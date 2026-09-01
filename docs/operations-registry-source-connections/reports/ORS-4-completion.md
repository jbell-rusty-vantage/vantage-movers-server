# ORS-4 completion

Closed 2026-09-01. Branch `operations-registry-source-connections` in both
`vantage-main-server` and `vantage-admin`. No commit, push, or deploy.

The Owner now sees Lead Source + Granot name as one flow. The wizard is the
primary create path (single Feed). Go-live is the persistent readiness
checklist on Lead Source detail. Inbound numbers belong to a Lead Source →
Feed; the nickname never decides where a call goes.

## Files added — vantage-main-server

- `src/services/operationsRegistry/ownerLanguageDeck.ts`
- `src/services/operationsRegistry/ownerLanguageDeck.test.ts`
- `docs/operations-registry-source-connections/sessions/ORS-4-process.md`
- `docs/operations-registry-source-connections/reports/ORS-4-completion.md`

## Files changed — vantage-main-server (this pass)

- `src/services/operationsRegistry/queries/leadSourceProjection.ts` — additive
  `GranotLandingItem.live` and `LeadSourceDetail.readiness_plan`
- `src/services/operationsRegistry/queries/leadSourceProjection.test.ts`
- `src/services/operationsRegistry/queries/health.ts` — Owner observation-window
  sentence + evidence (`observation_window_started_at: "2026-09-01"`)
- `src/services/operationsRegistry/queries/health.test.ts`
- `src/services/operationsRegistry/queries/findingTranslation.ts` — window start
  and “blocked until zero”
- `src/services/operationsRegistry/index.ts` — language-deck + readiness exports
- `docs/operations-registry-source-connections/issues/ORS-3.md` — projection
  amendment
- `docs/operations-registry-source-connections/issues/ORS-4.md` — §4 reverify
- `docs/operations-registry-source-connections/reports/ORS-3-completion.md` —
  amendment already recorded
- `docs/operations-registry-source-connections/PROGRESS.md`

No new server mutation. Setup commit and Granot create remain the ORS-2 / ORS-3
commands.

## Files added — vantage-admin

- `components/operations-registry/lead-sources/lead-sources-manager.tsx`
- `components/operations-registry/lead-sources/lead-source-detail.tsx`
- `components/operations-registry/lead-sources/feed-card.tsx`
- `components/operations-registry/lead-sources/connection-line.tsx`
- `components/operations-registry/lead-sources/readiness-badge.tsx`
- `components/operations-registry/lead-sources/readiness-checklist.tsx`
- `components/operations-registry/lead-sources/setup/lead-source-setup-wizard.tsx`
- `components/operations-registry/granot-names/granot-name-editor.tsx`
- `components/operations-registry/inbound-numbers/inbound-number-editor.tsx`
- `components/operations-registry/compatibility-observation-statement.tsx`
- `lib/api/leadSources.ts`
- `lib/operations-registry/ownerLanguageDeck.ts`
- `lib/operations-registry/granotReviewSentence.ts`
- `lib/operations-registry/smsPreview.ts`
- `lib/operations-registry/inboundNumberStatus.ts`
- `lib/operations-registry/ors3LeadSourceDetailFixture.ts`
- `tests/lead-source-detail.test.ts`
- `tests/granot-name-editor.test.ts`
- `tests/lead-source-setup.test.ts`
- `tests/inbound-number-editor.test.ts`
- `tests/language-deck.test.ts`

## Files changed — vantage-admin

- `components/operations-registry/registry-tabs.ts` — new ids + legacy `?tab=`
  redirects (`LEGACY_REGISTRY_TAB_DROP_DATE = 2026-12-01`)
- `components/operations-registry/registry-shell.tsx` — deck-safe description;
  Moving Carriers and Legacy CPL kept
- `components/operations-registry/granot-crm-sources-manager.tsx` — list + new
  editor; create submits `OwnerGranotNameCommand`
- `components/operations-registry/ringcentral/route-detail.tsx` — wraps inbound
  number editor
- `components/operations-registry/ringcentral/route-editor.tsx`
- `components/operations-registry/ringcentral/routes-list.tsx`
- `components/operations-registry/registry-health-findings.tsx`
- `components/operations-registry/registry-overview.tsx`
- `lib/api/registryGranotCrmSources.ts` — `daily_cap` dropped from Owner view
  type
- `lib/api/registryRingCentral.ts` — assignment labels
- `lib/api/registryEntityLinks.ts` + test
- `lib/query/keys.ts` + test
- `server/auth/authorization.ts` + test
- `tests/registry-shell.test.ts`
- `tests/granot-crm-sources-manager.test.ts`
- `CONTEXT.md` — Operations Registry pointer

Left untouched (unrelated dirty files):

- `components/granot-lifecycle/booking-command-form.tsx`
- `components/granot-lifecycle/official-binder-agents-fields.tsx`

`source-companies-manager.tsx` remains as the advanced/legacy path under Lead
sources.

## Wizard commit points

1. **Save as draft** — one `POST /api/v1/admin/operations-registry/lead-source-setups`.
   Creates Lead Source + first-class Feed + optional Granot name, all inactive.
   Review renders only `POST …/lead-source-setups/preview`. The browser does not
   reimplement validation.
2. **Turn it on** — not a wizard step. After save, navigate to Lead Source
   detail. The persistent `ReadinessChecklist` re-reads `readiness_plan` from
   `GET …/lead-sources/:id` after each existing audited command. No row ticks
   itself. A blocked row states `Waiting on: …`.

Granot step is skippable (`Not yet`). Texting is configured in step 3 and
saved in commit 2. Wizard copy: “Texting is set up after the Granot name is
saved. We will bring you back to this on the next screen.”

**Single-feed wizard is the primary path.** ORS-3's setup DTO is one channel /
one Feed. “Add separate feeds” is: save the first draft, add Feeds via existing
routes, connect Granot via the Granot editor. No second setup DTO.

## Language deck

Shared banned list (must match; comments say so):

```text
granularity, lifecycle, disposition, route_key, lead_model, policy_version
```

- Server: `ownerLanguageDeck.ts` — walker skips `advanced` and `id` / `*_id` /
  `deep_link`. Asserts a live ORS-3-shaped detail projection.
- Admin: same six terms plus §7.6 Avoid phrases. Asserts visible markup after
  stripping `<details>`.

## Tab redirects

| Old `?tab=` | New id | Label |
| --- | --- | --- |
| `sources` | `lead-sources` | Lead sources |
| `granot-sources` | `granot-names` | Granot names |
| `ringcentral` | `inbound-numbers` | Inbound numbers |
| `cpl` | `lead-costs` | Lead costs |

Kept: Overview, Agents, Merchants, Moving Carriers, Legacy CPL, Changes.

Proposed drop date for old `?tab=` values: **2026-12-01**.

Shell description now uses lead sources, Granot names, inbound numbers, moving
carriers, and lead costs. It no longer says “source companies, granularities,
Granot CRM sources, RingCentral.”

## Authorization — independent proofs

**Server** (`v1.routes.ts`):

- `GET …/lead-sources` and `GET …/lead-sources/:id` — `requireRegistryReadActor`
- `POST …/lead-source-setups/preview` — `requireRegistryReadActor` (read-preview)
- `POST …/lead-source-setups` — `requireRegistryOwnerActor`
- `POST …/granot-crm-sources` — already `requireRegistryOwnerActor` (ORS-2)

`requireRegistryOwnerActor` sets `requireOwner: true` in `trustedActor.ts`.
Covered by `trustedActor.test.ts` (pre-existing) plus route registration in
`v1.routes.test.ts`.

**Proxy** (`vantage-admin/server/auth/authorization.ts`):

- `/api/v1/admin/operations-registry` already Owner-mutation
- `/api/v1/admin/granot-crm-sources` already Owner-mutation
- Added `/api/v1/admin/source-label-mappings` to `REGISTRY_OWNER_MUTATION_PREFIXES`
- Added `POST …/lead-source-setups/preview` and
  `POST …/source-label-resolution/preview` to `REGISTRY_READ_PREVIEW_POST_PATHS`

`authorization.test.ts` asserts:

- admin GET `…/lead-sources` → allowed
- admin POST `…/lead-source-setups/preview` → allowed
- admin POST `…/lead-source-setups` → **blocked**
- owner POST `…/lead-source-setups` → allowed
- admin POST `…/granot-crm-sources` → **blocked**
- owner POST `…/granot-crm-sources` → allowed
- admin POST `…/source-label-resolution/preview` → allowed
- admin POST `…/source-label-mappings` → **blocked**
- owner POST `…/source-label-mappings` → allowed

Inconsistent company / Feed IDs are still rejected by the server (ORS-2 / ORS-3
tests). The proxy does not re-validate those IDs; it gates who can reach the
mutation. That split is the independent proof.

## Observation window (§9.7)

Opened **2026-09-01**. Not closed. Nothing removed.

Health finding `registry.compatibility_reads_remaining` now says how many
compatibility reads used the old static list since that date, and that removal
is blocked until the count holds at zero. Evidence includes
`observation_window_started_at`, `read_count`, `removal_blocked_until_zero`.

Registry Health always renders `CompatibilityObservationStatement` with the
same start date.

## Screenshots and preview deploys

**None.** Preview deploy was not authorized. No screenshots were taken. No
deployment ids exist. This report does not invent them.

## Test / typecheck / build

### Server focused tests (2026-09-01)

```text
node --import tsx --import ./scripts/test-setup.ts --test \
  src/services/operationsRegistry/ownerLanguageDeck.test.ts \
  src/services/operationsRegistry/queries/leadSourceProjection.test.ts \
  src/services/operationsRegistry/queries/findingTranslation.test.ts \
  src/services/operationsRegistry/queries/health.test.ts \
  src/services/operationsRegistry/leadSourceSetup.test.ts
```

```text
✔ banned-term constant is the shared six-term list
✔ ORS-3 detail projection Owner strings stay inside the language deck
… (30 tests)
ℹ tests 30
ℹ pass 30
ℹ fail 0
ℹ duration_ms 41687.8487
exit_code: 0
```

### Server typecheck

```text
pnpm typecheck   # tsc --noEmit
exit_code: 0
```

### Admin tests

```text
pnpm test
ℹ tests 388
ℹ pass 388
ℹ fail 0
ℹ skipped 0
exit_code: 0
duration_ms 3548.5445
```

Required surfaces covered:

- `tests/lead-source-detail.test.ts` — §7.2 from ORS-3 fixture; empty lead
  source / empty call feed / empty form-feed labels
- `tests/granot-name-editor.test.ts` — step order; move-type hidden; both
  review sentences verbatim; text-off sentence
- `tests/lead-source-setup.test.ts` — steps; skippable Granot; preview-driven
  review
- `tests/inbound-number-editor.test.ts` — nickname helper; connection card;
  checklist; From / Until / Lead source / Feed; **stopped filing calls**
- `tests/language-deck.test.ts` — banned vocabulary on primary surfaces
- `tests/registry-shell.test.ts` — new tab ids + old `?tab=` redirects
- `server/auth/authorization.test.ts` — prefixes and the two mutations
- `tests/granot-crm-sources-manager.test.ts` — SMS preview: Vantage Movers,
  empty first name `there`, leftover `{company}` → Vantage Movers, opt-out
  appended

### Admin typecheck

```text
pnpm typecheck   # tsc --noEmit
exit_code: 0
```

### Admin build

```text
pnpm build
exit_code: 0
elapsed_ms: 57750
```

Includes `/operations-registry`. No preview URL. No deployment id.

## What was not done

- **§9.8 removals.** Static maps, embedded `granularities[]`, their indexes,
  and the stored `daily_cap` field **remain**. This pack does not remove them.
  Removal is a separately reviewed migration after the observation window holds
  at zero. The Owner still decides window duration
  (`PROGRESS.md` open question).
- Multi-feed in one commit 1. Single-feed wizard only.
- Preview deploy, screenshots, production SMS, commits, or pushes.
- Redesign of Agents / Merchants / Overview / Changes beyond tab labels and
  deck copy.
- New server mutations.
- Change to label-mapping, Granot, or RingCentral matching semantics.

## Honest remainder

ORS-1 through ORS-4 are `complete` as buildable Owner surfaces. The pack is
**not** finished as a removal program.

A pack that claims itself finished while static maps, embedded
`granularities[]`, indexes, and stored `daily_cap` remain is the failure mode
the ledger exists to prevent. Those stay until §9.7 holds at zero and a
separately reviewed §9.8 migration is authorized.

## Confirmation

No SMS was enabled. No lifecycle activation flag was changed. No message was
sent. No production index was applied. No live production payload was read.
No commit or push.
