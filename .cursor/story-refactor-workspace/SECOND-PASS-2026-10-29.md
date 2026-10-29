# Second recommendation pass — 2026-10-29

The second pass found substantial misses in the first refresh. This pass closes additional stale advice and restores useful constraints so the owner can start per-story implementation design from a more dependable catalog.

All **338 active briefs** received a second source review: **217 corrected or clarified**, **121 checked without further correction**. All **56 prior removals** were rechecked and retained.

There are 255 recorded per-file findings. These are documentation findings, not 255 runtime bugs. Corrected/clarified includes false behavior claims, missing operation constraints, caller/export inventory fixes and editorial cleanup. A source check is not an executed parity test or production qualification.

## Material corrections

- **Current behavior and enforcement:** WordPress receipt model hooks do not enforce non-null repoint protection across all writes; conditional service attachment is separate. Other model briefs now distinguish Mongoose guards from database constraints, declared indexes from installed indexes, and expiry clocks from TTL deletion clocks.
- **Actual Lead and booking paths:** Job-first enrichment replaces phone-first advice; CSV contact handling stays distinct from Granot observation contact cards. Owner employee-booking create-and-attach can directly create a Call Lead. Form/Call matching, mirror conditions and chronology use the actual current alternatives and fallbacks.
- **Live effects and data contracts:** Extension User Agent linking and sign-out/version effects, conditional catalog fields, OAuth Owner allowlist/login-hint handling, Sheet deletion reporting, and reviewed Estimates apply gates are now explicit. Source-text tests are distinguished from runtime behavior proofs.
- **Registry and Reporting:** Source resolution can consider an active Feed under an inactive parent before final parent validation in the global ladder. SMS daily-cap/off behavior, Reporting error/archive contracts, safe provider summaries, and worker/harness limitations were corrected.
- **RingCentral and tariff:** Webhook previews never authorize creation; current routes wake final parent Call Log validation. Diagnostic answered-call analytics stay distinct from answer-optional elapsed qualification. Tariff accepts 1–20 rows under its current catalog/shared-field rules rather than exactly two.
- **Dependencies and remaining cleanup:** Static import/re-export paths were resolved rather than guessed from matching filenames. The live lifecycle caller of the CRM name helper remains protected. Valid multioperation organization and parity guidance lost in the first pass was restored where supported by current source.

Independent cross-review of corrected business and integration briefs caught additional conditional-field, timestamp fallback, preflight-versus-unique-index, inactive-parent and duplicated-old-prose contradictions; the owning reviewers fixed those too.

## Evidence

| Scope | Audit |
| --- | --- |
| Admin, Analytics, bookings, commands, OAuth, Sheets and Granot HTTP/CSV | [second-pass-business.json](second-pass-business.json) |
| Lifecycle, timeline, Leads and models | [second-pass-lifecycle-models.json](second-pass-lifecycle-models.json) |
| Registry, Reporting, RingCentral, routes, search, Sheet Sync and remaining integrations | [second-pass-integrations.json](second-pass-integrations.json) |
| Removed briefs: 31 absent targets, 22 not-live integration entries, 3 historical Release entries | [second-pass-removals.json](second-pass-removals.json) |
| Shared directive and coverage corrections | [second-pass-root.json](second-pass-root.json) |
| Coverage boundaries and newer modules inside existing families | [COVERAGE.md](COVERAGE.md), [coverage-second-pass.json](coverage-second-pass.json) |
| Final structural/runtime-fingerprint checks | [second-pass-validation.json](second-pass-validation.json) |

Each active brief has exactly one second-pass audit entry with source/doc evidence. This audit supersedes first-pass review labels in the [current catalog](CATALOG-STATUS.md). The [first-pass report](REFRESH-2026-10-29.md) and its manifests remain historical evidence.

## What remains before implementation

Read the selected target and its current callers, decide useful names and module boundaries, and obtain targeted parity proof for the actual change. These reviews did not execute runtime tests, typecheck, provider calls, migrations, deployments or production checks. They do not certify every possible runtime outcome. No runtime source was changed, and existing unrelated work was preserved.

The catalog still has coverage gaps, not an automatic backlog of new refactors. Duplicate Lead remains the next implementation story when the owner requests it. This task did not start implementation.
