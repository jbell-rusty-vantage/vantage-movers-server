# Priority Pool release tooling

Run from the server root. Every command defaults to read-only or an isolated local replica. Production mutations are reserved for the primary release operator, after both compatible deployments are Ready.

```powershell
node --import tsx --test ops/pool-production/manifest.test.ts
node --import tsx ops/pool-production/shared-duty.replica.ts

# Fresh exact-ID candidate pins: private identities stay under the existing ignored ops/output directory.
node --env-file=.env --import tsx ops/pool-production/report.ts --target=vantagemovers --nominate=20 --private-out=ops/output/pool-pilot.json --summary-out=docs/rep-desk-and-pool/evidence/release/pilot-report.json

# Or review an explicit JSON [{model:"FormLead"|"CallLead",id:"<24 hex>"}] selection, at most20.
node --env-file=.env --import tsx ops/pool-production/report.ts --target=vantagemovers --leads=ops/output/pool-selected.json --private-out=ops/output/pool-pilot.json --summary-out=docs/rep-desk-and-pool/evidence/release/pilot-report.json

# Full canonical9 inventory, with separate pilot/other-assignment/unassigned/held cohorts. No apply option.
node --env-file=.env --import tsx ops/pool-production/inventory.ts --target=vantagemovers --private-out=ops/output/pool-expansion-review.json --summary-out=docs/rep-desk-and-pool/evidence/release/expansion-review.json
```

`report` performs a final read-only snapshot transaction. It pins the configuration revision/hash, Lead revision, receiver, current Registry source policy, accepted Observation and completed live Decision/Receipt, canonical Record Link/revision, subject revision and Sheet lineage. The server's canonical eligibility service also revalidates equivalent Job aliases across both Lead models and raw Booking anchors. Initial pilot readiness additionally requires assignment to an active eligible Desk Rep, existing Master lineage, and no closed/review subject. Absence of an ordinary subject alone is allowed. The manifest expires after30minutes. This is fresh canonical evidence; it does not claim a new provider survey or live Google Sheet row check.

The inventory deliberately separates **canonical shared Lead eligibility** from **initial pilot receiver readiness**. An otherwise coherent Lead assigned to another receiver stays eligible for shared team Pool work, preserves its receiver, and is listed for assignment review. An unassigned Lead stays unassigned and gets its own routing-review cohort. Only source/identity/official-closure/closed-subject holds are domain exclusions. This report never grants admission authority.

Configuration plan (the expected revision comes from a fresh configuration read):

```powershell
node --env-file=.env --import tsx ops/pool-production/configure.ts --target=vantagemovers --enabled=true --expected-revision=<revision> --approval-ref=POOL-APPROVAL-2026-10-14
```

Adding `--apply` installs only the optional `pool` namespace through the existing versioned configuration command. Every other policy field is carried over. `admission_enabled` defaults to false. Regenerate the pilot report after this revision changes. After pilot observation and reviewed expansion, the primary operator may explicitly plan/apply `--admission-enabled=true` to enable prospective admission through the canonical webhook/collector projector. Disabling Pool requires admission false.

Pilot plan:

```powershell
$poolManifestHash = (Get-Content docs/rep-desk-and-pool/evidence/release/pilot-report.json | ConvertFrom-Json).private_manifest_hash
node --env-file=.env --import tsx ops/pool-production/activate.ts --target=vantagemovers --manifest=ops/output/pool-pilot.json --manifest-hash=$poolManifestHash --approval-ref=POOL-APPROVAL-2026-10-14
```

Adding `--apply` calls only the canonical selected-ID membership service inside the CSI command transaction. Fresh pins/configuration are checked again in that transaction. The whole at-most20 cohort commits with its audit and command ledger or rolls back. Reusing the same file/hash replays its committed result; changing the file refuses a mismatched hash. It requires Pool enabled with automatic admission disabled. Production configuration/pilot writes refuse schema-drift overrides, dirty runtime/tooling imports and a local HEAD that differs from the recorded deployment.

Build the additive Pool indexes through the existing `pnpm outreach:indexes --target=vantagemovers` plan and its explicit `--apply` mode. In particular, `sod_pool_duty_lead_date_kind_unique` is the canonical Lead/date/`pool_call` quota fence. Do not add episode, receiver or policy to this uniqueness key.

The pilot entrypoint never expands beyond 20. The separate expansion entrypoint requires a committed pilot and deliberate reviewed cohort hashes, then fresh per-Lead pins. The current authorized upper bound is 601 existing canonical Leads; it never creates an unmatched Lead. The 241 held provider rows are not candidate Leads and remain outside the canonical report.

After the primary operator reviews the private inventory and the three cohorts, prepare a fresh expansion file (the hash variables come from the sanitized inventory summary):

```powershell
$poolReview = Get-Content docs/rep-desk-and-pool/evidence/release/expansion-review-2026-10-14.json | ConvertFrom-Json
node --env-file=.env --import tsx ops/pool-production/expansion.ts --target=vantagemovers --review=ops/output/pool-expansion-review-2026-10-14.json --review-hash=$($poolReview.private_review_hash) --cohorts=pilot_ready,assigned_other_review,unassigned_review --pilot-hash=$($poolReview.assigned_selection_hash) --assigned-other-hash=$($poolReview.assigned_other_selection_hash) --unassigned-hash=$($poolReview.unassigned_selection_hash) --private-out=ops/output/pool-expansion-fresh.json --summary-out=docs/rep-desk-and-pool/evidence/release/expansion-fresh.json --approval-ref=POOL-APPROVAL-2026-10-14
$poolExpansion = Get-Content docs/rep-desk-and-pool/evidence/release/expansion-fresh.json | ConvertFrom-Json
node --env-file=.env --import tsx ops/pool-production/expansion.ts --target=vantagemovers --manifest=ops/output/pool-expansion-fresh.json --manifest-hash=$($poolExpansion.private_manifest_hash) --approval-ref=POOL-APPROVAL-2026-10-14
```

The second command is a dry run. Only after reviewing the fresh aggregate/hash, add `--apply` to that exact command. Each at-most20-Lead batch revalidates all pins/configuration and commits its membership/audit/CSI ledger atomically. The manifest's frozen ID set never grows. Same-file apply retries replay committed batches before continuing; source/assignment/cohort/configuration drift or a 30-minute expiry stops later batches for renewed review. Other receivers and Unassigned are preserved. A partial run never silently switches to a new inventory.

The collector's additive TTL index is separate from the Outreach registry:

```powershell
node --env-file=.env --import tsx ops/pool-production/indexes.ts --target=vantagemovers
```

Its explicit `--apply` builds only `granot_estimates_schedule_slots.granot_estimates_schedule_retention` (`purge_at`, TTL0), with the same clean-deployment writer guard. The production historical sweep uses80 independent authenticated children, approximately480baseline HTTP requests before splits/retries; the shared-session85-request discovery estimate is a different execution shape.

Rollback: plan and apply `configure --enabled=false --admission-enabled=false` using the current expected revision. The configuration transaction closes active episodes at the disable boundary and stops new Pool scheduling/sharing/admission. Historical provider corrections still recompute existing original duties; no new disabled duties are created, and gap calls cannot fulfill same-day reentry. Preserve canonical priorities, receivers, Sheets, duties, event/audit history and completed goal credit. Never bulk-delete Leads, reopen closed subjects or rewrite historical quota.

The replica proof refuses arguments and erases inherited external/Mongo bindings before imports. It uses the fixed loopback `csi01:27189` endpoint and a unique `testvantagemovers_pool20261014...` database, checks the actual replica members, uses synthetic data and disabled Sheets/messaging, and drops only its own database. Its evidence contains no operational identities or customer data.
