# Local task ledger

Preparation state: ready for isolated implementation; no implementation task is accepted. Local repository/branch/HEAD and initial dirty files must be recorded on claim. Preserve server's existing .gitignore change. Parent preparation SHAs are in ../CODE-MAP.md; repin cloud checkouts.

| ID | Owner | Depends on | Status | Claimed files / checkout | Evidence / next handoff |
| --- | --- | --- | --- | --- | --- |
| SOD-A | A coordinator/contracts | none | ready | unclaimed | S0/S1 -> B/C/D/E/F |
| SOD-B | B cadence/lifecycle | A interface | ready | unclaimed | S2 -> D/E/F |
| SOD-C | C capture/goals | A interface; E01 for live | ready | unclaimed | S2 -> D/E/F |
| SOD-D | D migration/readiness | A early design; B/C for S5 | ready | unclaimed | S3/S5/S6 -> A/F |
| SOD-E | E admin | A DTO freeze; local mocks available | ready | unclaimed | S3 -> F |
| SOD-F | F verification | A plan; integrated B/C/D/E | ready | unclaimed | S4/S5/S6/S7 -> A |

Allowed states ready/claimed/in_progress/review/blocked/accepted. A/F record acceptance with evidence. Blocking issues include decision/proof IDs, concrete failing scenario, owning team and resolution dependency. Do not mark skipped tests accepted.
