# ORS-4 process notes

Started 2026-09-01 on branch `operations-registry-source-connections` in both
`vantage-main-server` and `vantage-admin`. Closed 2026-09-01. No commit
authorized. No SMS enabled, no lifecycle flag changed, no message sent, no
production index apply, no preview deploy.

Unrelated dirty files in `vantage-admin` left untouched:
`components/granot-lifecycle/booking-command-form.tsx`,
`components/granot-lifecycle/official-binder-agents-fields.tsx`.

## §4 reverify

Observed 2026-08-24; rechecked 2026-09-01 against both repositories after ORS-3.

| Claim | Status |
| --- | --- |
| `registry-tabs.ts` / shell tabs `overview`, `agents`, `merchants`, `sources`, `granot-sources`, `ringcentral`, CPL, `changes` | **Drift.** Tabs also include `moving-carriers` and `legacy-cpl` (already shipped). Spec §7.1 omitted them; ORS-4 §7 says keep them. Line numbers in the shell description are 79–81, not 83–84. |
| Shell description uses "source companies, granularities, Granot CRM sources, RingCentral" | Confirmed. Violates §7.6. Rewritten this pass. |
| No `lead-sources` tab | Confirmed before this pass. Now `lead-sources`. |
| Components listed in the issue are present | Confirmed, plus CPL / Moving Carriers / Legacy CPL surfaces. |
| `authorization.ts` OWNER_ONLY_PAGE_PREFIXES and registry mutation prefixes | **Drift.** Prefix list is longer than the 2026-08-24 snapshot (`/job-timeline`, `/conversations`, `/live-events` on pages; catalog, moving-carriers, CPL, RingCentral, ingestion, Granot automation, Granot CRM sources on mutations). `REGISTRY_READ_PREVIEW_POST_PATHS` had only source-resolution preview and Best Relocation inspect. New setup preview and label-resolution preview were missing. |
| `queries/health.ts` emits `registry.compatibility_reads_remaining` | Confirmed. Summary was process-local, not an Owner observation-window sentence. |

Corrected in `issues/ORS-4.md` §4 in this pass.

## Decisions

- **Keep Moving Carriers and Legacy CPL.** Spec §7.1 IA line omitted them; they already exist and this pass does not redesign them.
- **Legacy `?tab=` values** `sources`, `granot-sources`, `ringcentral`, `cpl` resolve to the new ids. Proposed drop date: 2026-12-01.
- **Single-feed wizard is the primary path.** ORS-3 setup command is one channel / one Feed. "Add separate feeds" is documented as save-draft then add Feeds via existing routes. No second setup DTO.
- **Step 5 is the detail readiness checklist**, not a wizard step. After Save as draft the Owner lands on the Lead Source detail.
- **Readiness plan on the detail projection.** Added `readiness_plan` (status-annotated) and Granot `live` so the checklist re-reads from one GET rather than inventing admin-only gate state. ORS-3 issue/report amended.
- **SMS preview** no longer interpolates the partner name for `{company}`. Leftover `{company}` renders as **Vantage Movers**. Empty first name is `there`. Opt-out is appended and counted.
- **Observation window** opened 2026-09-01. Nothing removed.
- **Language deck** is one exported list in both repos. Comments say they must match.

## Commands run

```text
# server
node --import tsx --import ./scripts/test-setup.ts --test \
  src/services/operationsRegistry/ownerLanguageDeck.test.ts \
  src/services/operationsRegistry/queries/leadSourceProjection.test.ts \
  src/services/operationsRegistry/queries/findingTranslation.test.ts \
  src/services/operationsRegistry/queries/health.test.ts \
  src/services/operationsRegistry/leadSourceSetup.test.ts
# → 30 pass, 0 fail, exit 0

pnpm typecheck
# → tsc --noEmit, exit 0

# admin
pnpm test
# → 388 pass, 0 fail, exit 0

pnpm typecheck
# → tsc --noEmit, exit 0

pnpm build
# → exit 0, elapsed_ms 57750. Includes /operations-registry.
#    No preview URL. No deployment id.
```

## What this pass did not do

- §9.8 removals (static maps, embedded `granularities[]`, indexes, stored `daily_cap`)
- New server mutations
- Multi-feed in one setup commit
- Preview deploy, screenshots, production SMS, commits, or pushes
