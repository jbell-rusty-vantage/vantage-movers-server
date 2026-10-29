# Story-refactor workspace

Recommendations for maintainability work, separate from implementation progress and canonical Service docs.

The owner requested a catalog-wide refresh on **2026-10-29** because the September recommendations no longer matched the live services and models. That maintenance request supersedes the old no-rewrite rule. The recommendation tour remains closed; this refresh does not resume traversal or implement any refactor.

Latest source review: [SECOND-PASS-2026-10-29.md](SECOND-PASS-2026-10-29.md). The second pass corrected important first-pass misses; use its per-file audit alongside the current catalog.

## Start here

1. Read [DIRECTIVE.md](DIRECTIVE.md) for scope and outcome-preservation rules.
2. Read [CATALOG-STATUS.md](CATALOG-STATUS.md) for the current active inventory, removals and review evidence.
3. Read the selected recommendation, its current target, matching Service doc and callers before designing an implementation.
4. Record actual implementation work in `../story-implementation-workspace/`, using the implementation skill when the owner starts that work.

The next implementation story remains [Duplicate Lead](recommendations/leads-duplicate-lead.md), when the owner asks to start. Form Lead and Call Lead story names already exist; their briefs describe remaining review/test work rather than repeating the rename.

## Authority and limits

| Question | Source |
| --- | --- |
| Which recommendations remain useful? | [CATALOG-STATUS.md](CATALOG-STATUS.md) and the refresh audit it links |
| What is this program allowed to change? | [DIRECTIVE.md](DIRECTIVE.md) |
| What does the server do now? | Current code and matching `docs/knowledge/services/` documents |
| Has a refactor actually landed or been qualified? | `../story-implementation-workspace/` and verified Git/test evidence |
| What did September agents recommend? | [TRAVERSAL.md](TRAVERSAL.md), historical `sessions/`, `MESSAGES.md` and `CONTRADICTIONS.md` |

The refreshed briefs are implementation starting points. They do not certify proposed names, every caller, test coverage or functional parity. Remove obsolete instructions rather than restoring retired services. Keep outcomes, persisted names, authority checks, transaction boundaries and side-effect order unless a separate behavior change is authorized.

`TRAVERSAL.md` is the frozen September map. Its counts, links and next-module pointer are historical; do not resume `IngestionRun.ts`. Older sessions/messages can name recommendations removed in this refresh. [CATALOG-STATUS.md](CATALOG-STATUS.md) takes precedence.

## Writing here

- `recommendations/`: active briefs only; removed entries are recorded in the refresh audit.
- `NOW.md`: current pointer, not an implementation board.
- `MESSAGES.md`: newest coordination note first; retain older entries as history.
- Refresh evidence: per-file dispositions and a dated report.
- `sessions/`, `TRAVERSAL.md`, `IDEAS.md`, `CONTRADICTIONS.md`: historical evidence unless a later owner request explicitly changes their purpose.

Do not add `type:` YAML or duplicate canonical Service documents here. Runtime edits, deployment and production operations are outside a recommendation refresh.
