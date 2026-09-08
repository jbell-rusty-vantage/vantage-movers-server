# Session story-reporting-pii-safe-evidence-2026-09-08T0111Z

- Date (UTC): 2026-09-08
- Service / module: `reporting` / `live/piiSafeEvidence.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/205

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 27 / 1 / 10
- Recommendations on disk: 231
- Current service / next module (TRAVERSAL): `reporting` / `live/piiSafeEvidence.ts`

## This pass

- opened new service?: no
- path or skip: recommended `src/services/reporting/live/piiSafeEvidence.ts` → [recommendations/reporting-pii-safe-evidence.md](../recommendations/reporting-pii-safe-evidence.md)
- operations named: mask this Google file id so we can still match the folder; mask this long run tag; redact this string we might log; drop keys that look like a customer or a secret; hand the owner a bag they can log. `SENSITIVE_KEY` eats step `name`. Two `maskGoogleFileId` folds. Digit checksums and GitHub run ids look like Drive ids / phones.
- remaining in this service: `live/testArtifactJanitor.ts` first, then leftover later evaluate

## Stock at end

- Visited / in-progress / unvisited: 27 / 1 / 10
- Current service / next module: `reporting` / `live/testArtifactJanitor.ts`

## Messages posted

- 2026-09-08T0111Z next-run

## Ideas parked

- none

## Contradictions

- none
