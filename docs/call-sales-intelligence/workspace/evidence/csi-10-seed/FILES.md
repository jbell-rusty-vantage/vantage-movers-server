# CSI-10 production seed files

## Admin

- `vantage-admin/components/sales-intelligence/reps.tsx`
- `vantage-admin/components/sales-intelligence/sales-intelligence-copy.ts`
- `vantage-admin/lib/api/salesIntelligence.ts`
- `vantage-admin/lib/api/salesIntelligence.test.ts`

## Server

- `src/services/salesIntelligence/repIdentity/reads.ts`
- `docs/knowledge/services/sales-intelligence-rep-identity.md`

## Coordination

- `docs/call-sales-intelligence/workspace/LEDGER.md`
- `docs/call-sales-intelligence/workspace/CONTRACTS.md`
- `docs/call-sales-intelligence/workspace/teams/c-outreach.md`
- `docs/call-sales-intelligence/workspace/evidence/csi-10-seed/**`

## Seed operators (evidence, not a new public CLI)

- `ensure-unique-fences.ts` — unique fences only
- `compare-roster.ts` — stop if Jason/Benjamin or Tyler identities moved
- `propose-and-review.ts` — signed Owner propose/review/prove
