# Session story-granot-lifecycle-drainer-2026-08-27T0110Z

- Date (UTC): 2026-08-27T0110Z
- Service / module: `granotLifecycle` / `drainer.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/57

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 11 / 1 / 26
- Recommendations on disk: 53
- Current service / next module (TRAVERSAL): `granotLifecycle` / `drainer.ts`

## This pass

- opened new service?: no
- path or skip: recommended `src/services/granotLifecycle/drainer.ts` → [recommendations/granot-lifecycle-drainer.md](../recommendations/granot-lifecycle-drainer.md)
- operations named: parse the queue wakeup; drain this requested receipt; drain the due receipts; claim this receipt or wait for the winner; finish the claimed work behind the fence (complete / pending-match clock / technical retry / dead letter)
- remaining in this service: `aggregateRevision.ts` and the rest of the `granotLifecycle` checklist

## Stock at end

- Visited / in-progress / unvisited: 11 / 1 / 26
- Current service / next module: `granotLifecycle` / `aggregateRevision.ts`

## Messages posted

- 2026-08-27T0110Z next

## Ideas parked

- none

## Contradictions

- Knowledge says processor emits `unmatched` at 24h; drain completes a still-`pending_match` Decision
- Recovery metric increments at recover-claim, not after successful finalize
- `claimAndProcessOrPoll` reprints the completed-Decision load twice
