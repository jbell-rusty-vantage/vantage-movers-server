# CSI-14 destination + P2 checks

Working directories: `vantage-main-server` and `vantage-admin`. No `.env` writes, flag enablement, official index migration, live send, commit, or push.

| Exact command | Result |
| --- | --- |
| `node --import tsx --import ./ops/test-setup.ts --test src/services/salesIntelligence/nudges/*.test.ts src/services/salesIntelligence/repIdentity/identity.test.ts` | **18 pass / 0 fail** (includes destination-rejection event shape) |
| `pnpm test:csi:nudges:replica` | 18 pass / 0 fail (isolated `testvantagemovers_csi14c93bcb5b4fdc` on loopback `csi01:27189`; fake providers only). Log: [replica.log](replica.log) |
| `pnpm test:csi:rep-identity:replica` | 12 pass / 0 fail |
| `pnpm typecheck` | exit 0 after one `effective_to` nullable-date fix |
| `pnpm lint` | exit 0 |
| Admin `node --import tsx --test lib/api/salesIntelligence.test.ts` | 9 pass / 0 fail |
| Admin `pnpm exec tsc --noEmit` | exit 0 |
| `pnpm finish-work --provider cursor --no-apply --model composer-2.5` | run `1789834716855-f5ff3f75`, **patch-ready**, isolated checks 0, offline **2437 pass / 115 skip / 0 fail**, quality-runner **12/12**, `QUALITY_RESULT: PASS`. Patch not applied. See [REVIEW.md](REVIEW.md) |

P2 proof: unit cases reject `Alex, call the customer tomorrow.` and `Please urgently call the customer.`; replica restricted-work preview **and** send reject those edits with `submits` unchanged.

Destination proof: replica sends pager to unmatched User `Joshua L` with no `RepIdentityLink` write; reviewed link cannot enlarge snapshot channels; rolling limit is per User extension.

Observability: customer-destination rejection is an `OutreachRecord` event. That source edit happened after the Composer snapshot, so the snapshot is not independent current-source approval.

Live browser send was not run. `NUDGE_ENABLED` stayed off outside the replica wrapper. No local Admin/API stack was started for a Message-rep browser walk. Client contract tests cover preview/send shapes and destination-channel hints.
