# PROGRESS — Call Lead contact provenance

**This is the live ledger. Every issue updates it — on pickup and on close.**
It is a navigation aid, not an authority. Where it disagrees with the
repository, the repository is right and the next agent fixes this file.

Pack created 2026-09-04. Owner review 2026-09-04: HTTP/extension apply
stay shared; desk search required. Protocol:
[`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md). Contract:
[`call-lead-contact-provenance-specification.md`](call-lead-contact-provenance-specification.md).

## Issue status

| Issue | Title | Prereqs | Status | Owner / agent | Started | Closed | Report |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [CLCP-01](issues/CLCP-01.md) | Planner + synchronize: snapshot-only Call contact | spec | `complete` | coordinator + implementer | 2026-09-04 | 2026-09-04 | [CLCP-01-completion.md](reports/CLCP-01-completion.md) |
| [CLCP-02](issues/CLCP-02.md) | Call identity: Job wins, skip competing phone | CLCP-01 | `complete` | coordinator + implementer | 2026-09-04 | 2026-09-04 | [CLCP-02-completion.md](reports/CLCP-02-completion.md) |
| [CLCP-03](issues/CLCP-03.md) | Shared HTTP/extension preview + CSV | CLCP-01 | `complete` | coordinator + implementer | 2026-09-04 | 2026-09-04 | [CLCP-03-completion.md](reports/CLCP-03-completion.md) |
| [CLCP-05](issues/CLCP-05.md) | Owner desk any-known-contact | CLCP-01 | `complete` | coordinator + implementer | 2026-09-04 | 2026-09-04 | [CLCP-05-completion.md](reports/CLCP-05-completion.md) |
| [CLCP-04](issues/CLCP-04.md) | Knowledge and BILA pointer | CLCP-02, CLCP-03, CLCP-05 | `complete` | coordinator + docs-keeper | 2026-09-04 | 2026-09-04 | [CLCP-04-completion.md](reports/CLCP-04-completion.md) |

Status vocabulary: `ready` · `active` · `blocked` · `complete` · `deferred`.

## Session plan

| Session | Issues | Notes |
| --- | --- | --- |
| 1 | CLCP-01 | Only startable work. Invert AC-12. |
| 1 or 2 | CLCP-02 | May start in the same session after CLCP-01 tests are green. |
| 2 | CLCP-03 | Job-first preview; HTTP `syncable` for snapshot diffs; CSV no live contact. |
| 3 | CLCP-05 | Admin + intake + extension desk search. Phone must not miss. |
| 4 | CLCP-04 | docs-keeper after 02, 03, and 05. No flag apply. |

## Specification coverage

One row per specification section that this pack owns. A row is ticked
by the issue that closes it, with the evidence named.

| Spec § | Subject | Issue | Done | Evidence |
| --- | --- | --- | --- | --- |
| §4.1–4.3 / §5.1–5.3 | Snapshot-only qualified Call contact; live phone locked | CLCP-01 | ☑ | [CLCP-01-completion.md](reports/CLCP-01-completion.md); inverted `[AC-12]`; 32+7+10 tests |
| §4.4–4.5 / §6 | Job-wins Call identity; no snapshot phone query | CLCP-02 | ☑ | [CLCP-02-completion.md](reports/CLCP-02-completion.md); inverted unique Job vs other ANI; 29 identity tests |
| §5.5–5.6 | Shared preview/apply + CSV do not write live contact | CLCP-03 | ☑ | [CLCP-03-completion.md](reports/CLCP-03-completion.md); Job-first preview; skip+warn CSV; 9+5 tests |
| §7 automatic | Automatic match Job else operational phone | CLCP-02 (identity), CLCP-04 (docs) | ☑ | [CLCP-02-completion.md](reports/CLCP-02-completion.md); [CLCP-04-completion.md](reports/CLCP-04-completion.md) — identity Job else phone; knowledge + BILA pointer do not claim snapshot-phone auto-match |
| §7–§8 desk | Any-known-contact `q`; Called / Granot cards | CLCP-05 | ☑ | [CLCP-05-completion.md](reports/CLCP-05-completion.md); inverted Connect + projections Call `q`; Admin chip + Called/Granot cards |
| §11 | Knowledge Services + BILA pointer | CLCP-04 | ☑ | [CLCP-04-completion.md](reports/CLCP-04-completion.md) |

## Acceptance criteria (specification §12)

| # | Criterion | Issue | Done |
| --- | --- | --- | --- |
| 1 | RC Call + Priority 1/5 → snapshot only; live contact unchanged | CLCP-01 | ☑ |
| 2 | Later same Job, different Granot phone → coalesce; no phone conflict vs other ANI | CLCP-01, CLCP-02 | ☑ |
| 3 | First bind still granularity + operational/ingested phone | CLCP-02 | ☑ |
| 4 | Conflicting Jobs / two Job candidates / Form WordPress unchanged | CLCP-01, CLCP-02 | ☑ |
| 5 | No mint on `priority_updated` / `booking_status_changed` | all | ☑ |
| 6 | CSV never writes live phone; after CLCP-03 never live name/email | CLCP-03 | ☑ |
| 7 | HTTP + extension apply stay on capture → claim; Job-first preview; snapshot diffs approvable | CLCP-03 | ☑ |
| 8 | Automatic intake Job else phone; desk `q` any-known-contact | CLCP-02, CLCP-05 | ☑ |
| 9 | No effect flags; `sourcePolicy.ts` unchanged | all | ☑ |
| 10 | Knowledge matches shipped code | CLCP-04 | ☑ |

## Cross-issue findings

Work discovered in one issue that belongs to another. Do not fix it in
place — record it here and in the target issue.

| Found in | Belongs to | Finding | Recorded in issue |
| --- | --- | --- | --- |
| Owner review 2026-09-04 | CLCP-03 | Preview is phone-first on Granot mobile; HTTP `syncable` would drop contact-only snapshot diffs | this pack rewrite |
| Owner review 2026-09-04 | CLCP-05 | Admin / extension / intake Call search must find later Granot phone | this pack rewrite |
| CLCP-01 | CLCP-04 | `desired-state.md` still says Granot-created and RingCentral-created qualified contact become current operational fields; `processor.md` still says they plan current fields plus `last_granot_contact_change.changed_paths` | CLCP-04 |
| CLCP-01 | CLCP-02 | Job-vs-phone conflict still exists (`identity.ts` ~826–834) until CLCP-02 | CLCP-02 — resolved 2026-09-04 |
| CLCP-02 | CLCP-04 | `identity.md` still says “Job and phone pointing at different eligible Leads are conflict”; rewrite for Call after unique Job bind | CLCP-04 |
| CLCP-03 | CLCP-04 | `enrichment.md` must say leftover CSV does not write live contact; preview is Job-first; apply still processor. `extension-apply.md` / `automation-apply.md` get one sentence: same snapshot contact rule | CLCP-04 |
| CLCP-05 | CLCP-04 | Desk Call `q` now ORs live + ingested + Granot on browse / typeahead / intake / Connect / `GET /call-leads` / `POST /call-leads/search`. Rewrite `lead-browse.md`, `admin-search.md`, `call-lead-search.md`, `projections.md`. BILA §2 “live fields already are the enrichment” is false. Admin CONTEXT pointer still says not shipped. | CLCP-04 |

## Issue log

| When | Issue | Event |
| --- | --- | --- |
| 2026-09-04 | pack | Pack authored. CLCP-01 is the only `ready` issue. |
| 2026-09-04 | pack | Owner review: un-defer CLCP-05; rewrite CLCP-03 for shared HTTP/extension preview. |
| 2026-09-04 | CLCP-01 | Picked up. Repo `vantage-main-server`, branch `call-lead-contact-provenance`. |
| 2026-09-04 | CLCP-01 | Closed. Snapshot-only qualified Call contact for every origin. Report [CLCP-01-completion.md](reports/CLCP-01-completion.md). Unlocked CLCP-02, CLCP-03, CLCP-05 to `ready`. |
| 2026-09-04 | CLCP-02 | Picked up. Repo `vantage-main-server`, branch `call-lead-contact-provenance`. |
| 2026-09-04 | CLCP-02 | Closed. Unique Job/link wins; competing phone skipped. Report [CLCP-02-completion.md](reports/CLCP-02-completion.md). |
| 2026-09-04 | CLCP-03 | Picked up. Server branch `call-lead-contact-provenance`. Extension stays on `main` (package 0.2.8). |
| 2026-09-04 | CLCP-03 | Closed. Job-first preview; leftover CSV skip+warn; contact-only diffs stay updateable. Report [CLCP-03-completion.md](reports/CLCP-03-completion.md). |
| 2026-09-04 | CLCP-05 | Picked up. Server branch `call-lead-contact-provenance`. Admin branch `call-lead-contact-provenance`. |
| 2026-09-04 | CLCP-05 | Closed. Desk `q` any-known-contact; Admin Called / Granot cards. Report [CLCP-05-completion.md](reports/CLCP-05-completion.md). Browser walk: local Admin login 500 (Mongo); UI proven by component tests. |
| 2026-09-04 | CLCP-04 | Picked up. Repo `vantage-main-server`, branch `call-lead-contact-provenance`. docs-keeper pass. |
| 2026-09-04 | CLCP-04 | Closed. Knowledge matches shipped CLCP-01–03 and CLCP-05. Report [CLCP-04-completion.md](reports/CLCP-04-completion.md). |
| 2026-09-04 | follow-up | Owner search pass. Manual attach + intake / Connect phone tests lock snapshot paths. BLR `searchCandidates` now uses the same contact lists. No backfill. Identity and automatic match unchanged. |
