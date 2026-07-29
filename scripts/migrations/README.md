# Operations Registry migrations

## S0 — `operations-registry-inventory`

Read-only inventory for the Operations Registry initiative (M0). The script
collects Agents, Merchants, Source Companies, embedded granularities, legacy
`cpl_rates`, production Lead counts, RingCentral static/embedded numbers, and
static runtime authority references. It writes a redacted manifest under
`scripts/output/operations-registry-inventory/`.

- Dry run only — no `--apply` flag.
- Safe default target: `testvantagemovers` when `TEST_MODE=true`.
- Production (`vantagemovers`) requires
  `--confirm-production-db=vantagemovers`.
- Refuses `vantagemovershistorical` and unknown database names.

Commands:

```text
TEST_MODE=true pnpm migrations:operations-registry-inventory
node --import tsx --import ./scripts/test-setup.ts --test scripts/migrations/operations-registry-inventory.test.ts
```
