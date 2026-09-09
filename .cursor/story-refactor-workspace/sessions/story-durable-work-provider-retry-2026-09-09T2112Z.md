# Session story-durable-work-provider-retry-2026-09-09T2112Z

- Date (UTC): 2026-09-09
- Service / module: `durableWork` / `providerRetry.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 32 / 1 / 5
- Recommendations on disk: 275 (through `durable-work-schema.md`)
- Current service / next module (TRAVERSAL): `durableWork` (in-progress) / `providerRetry.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/durable-work-provider-retry.md`
- operations named: say what kind of Google or checksum throw this is; decide whether we still have time to try again, should wait past this deadline, or must stop; read the HTTP status off this throw
- remaining in this service: `runTransitions.ts`, `testing.ts`

## Stock at end

- Visited / in-progress / unvisited: 32 / 1 / 5
- Current service / next module: `durableWork` (in-progress) / `runTransitions.ts`

## Messages posted

- 2026-09-09T2112Z next

## Ideas parked

- none

## Contradictions

- `classifyGoogleFailure` also matches checksum / schema / capacity codes, not only Google HTTP
- HTTP 5xx wins over `CHECKSUM_MISMATCH`; 400 + checksum is structural
- `ProviderFailureClass` is not schema `failure.class`
- Sheets `withSheetsRetry` uses a different blip table and never asks this file
- `decideProviderRetry` has no live caller except unused `decideReportingProviderRetry`
