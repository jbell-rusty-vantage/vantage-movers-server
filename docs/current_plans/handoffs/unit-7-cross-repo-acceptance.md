## Operations Registry Unit 7 — Cross-repository acceptance

Date: 2026-07-31  
Work packages: D5, D6  
Dashboard branch: `vantage-admin` `feature/operations-registry`  
Server branch: `vantage-main-server` `main`

### Recorded SHAs

| Repo | Branch | SHA | Notes |
|------|--------|-----|-------|
| `vantage-admin` | `main` | `f961fe488fc32fff5d87a884b4ffb5ebd320de0a` | Merged D0–D6; production deploy trigger |
| `vantage-admin` | `feature/operations-registry` | `1864dc3c7e7627d2b3781c22e666c149d1213a5a` | Unit 7 D5–D6 commit |
| `vantage-main-server` | `main` | `76ad2338cdc8d821c2bf4cfbe041858f2b9fd524` | Handoffs + empty redeploy commit; tests green at prior `d15da87` |

### Dashboard gate

| Check | Result |
|-------|--------|
| `pnpm lint` | passed |
| `pnpm typecheck` | passed |
| `pnpm test` | **101** passed, 0 failed |
| `pnpm build` | passed; `/operations-registry` present |

### Server gate

| Check | Result |
|-------|--------|
| `pnpm test` | passed (`src/**/*.test.ts`) |
| `pnpm typecheck` | pre-existing failures in `scripts/dev_ops/**` only; not introduced by Unit 7. Runtime/registry `src` tests green. |

### Contract / acceptance checklist

- [x] Typed health findings render without generic fallback as the normal path
- [x] Entity/remediation deep links land on correct registry context
- [x] Changes filters/pagination URL-stable (`tab=changes` preserved)
- [x] Before/after diff sanitized; redacted values not revealed
- [x] `request_id` opens Admin Audit (Owner); API filter added
- [x] Read-only users see evidence/history; cannot mutate
- [x] Loading / retry / empty / partial states present on Health & Changes
- [x] Mutation invalidation covers required domains (tested)
- [x] Proxy role matrix covers health/changes reads + Owner mutations
- [x] No client module references signing secrets or imports `server/`
- [x] Distinct audit layers documented in Changes UI
- [ ] Live Owner/admin browser smoke against integration server (manual; not run here)
- [ ] Production mutation/provider calls — **not performed**

### Migration / rollback

- Migration/runbook evidence remains from S8 cutover handoff; UI rollback is
  redeploy prior dashboard build. Registry collections and routes stay server-side.
- Completing Unit 7 does not itself authorize production RingCentral/CPL cutover
  beyond what S8 already approved.

### Handoffs

- `unit-7-d5-dashboard.md`
- `unit-7-d6-dashboard.md`
- This acceptance record
