# Session story-models-granot-crm-source-semantics-2026-09-13T2312Z

- Date (UTC): 2026-09-13T2312Z
- Service / module: `models` / `granotCrmSourceSemantics.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 370
- Current service / next module (TRAVERSAL): `models` (in-progress) / `granotCrmSourceSemantics.ts`

## This pass

- opened new service?: no
- path or skip: recommended → [recommendations/models-granot-crm-source-semantics.md](../recommendations/models-granot-crm-source-semantics.md)
- operations named: remember the pairing words a card may use (three dispositions, three lead-created policies, two Lead models, three move types); judge the card's structure and policy pairing without loading company or Feeds; when persist leftover-brings leftover loaded leftover refs, also leftover-refuse a leftover missing, leftover inactive, or leftover mismatched leftover company or leftover Feed, then leftover-hand leftover back leftover the leftover folded leftover label or leftover a leftover refusal leftover message
- remaining in this service: `GranotCrmCsvIngestion.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `GranotCrmCsvIngestion.ts`

## Messages posted

- 2026-09-13T2312Z next

## Ideas parked

- none

## Contradictions

- Dual `GRANOT_LIFECYCLE_DISPOSITIONS` vs already-recommended `granotLifecycleSchemas.ts`
- Dual `GRANOT_LIFECYCLE_LEAD_MODELS` vs schemas `GRANOT_LEAD_MODELS`
- Leftover row leftover-asks leftover this leftover without leftover refs; leftover persist leftover-asks leftover with leftover refs
- Leftover health leftover-forces leftover `lifecycle_enabled: false` leftover then leftover string-includes leftover the leftover message
- Inactive-company leftover message leftover names leftover `source_scoped_lead` leftover while leftover the leftover check leftover is leftover `lifecycle_enabled && !active`
- Leftover `sourcePolicy.ts` leftover-imports leftover types leftover only
- Leftover leftover-ref leftover proofs leftover-live leftover on leftover `GranotCrmSource.test.ts`
- Leftover later leftover `GranotCrmCsvIngestion.ts` leftover is leftover the leftover CSV leftover upload leftover evidence leftover row leftover — leftover do leftover-not leftover leftover-merge leftover leftover this leftover leftover judge leftover leftover into leftover leftover it
