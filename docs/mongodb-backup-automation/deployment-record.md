# MongoDB backup automation — deployment record

## Deployment

| Field | Value |
|---|---|
| Date | 2026-09-01 |
| Operator | Cursor agent using `new-vantage-sheets@vantage-sheets-496816.iam.gserviceaccount.com` |
| Project | `vantage-sheets-496816` (`412588647450`) |
| Region | `us-east1` |
| Atlas region rationale | Production `hello` tags reported provider `AWS` and region `US_EAST_1`. `us-east1` is the matching North American GCP region from the plan. |
| Database | `vantagemovers` |
| Tools | MongoDB Database Tools `100.17.0` |
| Backup schema | `schema-v1` |

## Resources

| Resource | Name |
|---|---|
| Dedicated bucket | `gs://vantage-mongodb-backups-496816` |
| Artifact Registry | `us-east1-docker.pkg.dev/vantage-sheets-496816/vantage-operations` |
| Image tag | `vantage-mongodb-backup:v1-38d98c1` |
| Image digest | `sha256:5ff24690f9f8296042fb73719413d67949d18a302396a4a0c0a2b3913f5fa542` |
| Cloud Run Job | `vantage-mongodb-backup` |
| Runtime SA | `mongodb-backup-runner@vantage-sheets-496816.iam.gserviceaccount.com` |
| Scheduler SA | `mongodb-backup-scheduler@vantage-sheets-496816.iam.gserviceaccount.com` |
| Secret | `vantage-production-mongo-uri` version `1` (enabled; payload not disclosed) |
| Scheduler job | `vantage-mongodb-backup-daily` (`15 2 * * *`, `America/New_York`) |

Enabled APIs: `artifactregistry`, `cloudbuild`, `cloudscheduler`, `iam`, `run`, `secretmanager` (Storage, Logging, Monitoring, Service Usage, and Cloud Resource Manager were already on).

## First verified archive

Manual Cloud Run execution `vantage-mongodb-backup-hslzl`:

- Object: `backups/mongodb/vantagemovers/daily/schema-v1/2026/09/01/vantagemovers-20260901T182034Z-tools-100.17.0.archive.gz`
- Generation: `1788286846963136`
- Size: `14,655,142` bytes (13.98 MiB)
- SHA-256: `536707e239fd18e240dcb23c14514b1191e756681553bf90081410d50baa4c77`
- Job duration: `12,625` ms (execution wall time about 38 s)
- Manifest: `backups/mongodb/vantagemovers/manifests/schema-v1/2026/09/01/vantagemovers-20260901T182034Z.success.json`

Production at deploy time was about 82 collections / 216k documents / 170 MiB logical. A 14 MiB gzip archive is plausible. Tuesday run, so no weekly copy (expected).

Custom metadata on the object includes `source`, `kind`, `database`, `format`, `backup_schema_version`, `mongo_tools_version`, `created_at`, `retention_class=daily`, `sha256`, `size_bytes`, `owner=vantage`, and `execution_id`.

## Scheduler second restore point

After granting the Cloud Scheduler service agent `roles/iam.serviceAccountTokenCreator` on the scheduler SA, `gcloud scheduler jobs run vantage-mongodb-backup-daily` created additional executions as `mongodb-backup-scheduler@...`. The first archive was not overwritten:

- `.../vantagemovers-20260901T182034Z-tools-100.17.0.archive.gz` (14,655,142 B) — still present
- `.../vantagemovers-20260901T182807Z-tools-100.17.0.archive.gz` (14,658,869 B)
- `.../vantagemovers-20260901T182835Z-tools-100.17.0.archive.gz` (14,662,433 B)

Two scheduler executions landed about 15 seconds apart (manual run plus the earlier API attempt after IAM propagation). All three names are unique; `ifGenerationMatch=0` held.

## Restore-drill evidence

Isolated disposable `mongod` 7.0.25 on `127.0.0.1:27018` (temp dbpath). Restore used Database Tools 100.17.0:

```text
mongorestore --archive=restore.archive.gz --gzip \
  --nsFrom='vantagemovers.*' --nsTo='restore_probe.*'
```

Local SHA-256 of generation `1788286846963136` matched the manifest. Result:

- Databases on the probe: `admin`, `config`, `local`, `restore_probe` only (`vantagemovers` was not created)
- 82 collections, 216,207 objects, 170.6 MiB logical
- Count-only samples: `form_leads` 5109, `call_leads` 1432, `booked_leads` 616, `cancelled_leads` 48, `customers` 802

Production `dbStats` taken minutes earlier was 82 collections / 216,085 objects / 170 MiB. The small delta is consistent with a live database. Never restored into Atlas. Local dump and probe data were deleted after the drill.

## Retention and access

- Standard class, uniform bucket-level access, public access prevention enforced
- Soft delete 7 days (`604800` s)
- Object versioning off
- Lifecycle: delete after 8 days under `daily/` and `manifests/`; delete after 29 days under `weekly/`
- Runtime SA on this bucket only: `roles/storage.objectCreator` + `roles/storage.objectViewer` (no delete)
- Runtime SA has Secret Accessor on `vantage-production-mongo-uri` only, plus `roles/logging.logWriter`
- Scheduler SA has `roles/run.invoker` on `vantage-mongodb-backup` only
- Dumps were not written to `gs://vantage-sheets-496816/`
- Atlas IP allowlist was not changed; Cloud Run reached Atlas from the default egress pool

## Observability

- Structured job logs: `backup.started`, `dump.completed`, `upload.completed`, `verification.completed`, `backup.succeeded`
- Build and runtime logs were scanned; no Mongo URI or password strings
- Log-based metric: `logging.googleapis.com/user/vantage_mongodb_backup_succeeded`
- Alert `vantage-mongodb-backup execution failed` → email channel `Vantage owner backup alerts`
- Alert `vantage-mongodb-backup freshness missing` → same channel
- Owner notification destination: `ringram@vantagehomemovers.com` (existing GCP project owner). Confirm the inbox if a verification email arrived.

## Estimated monthly cost

At the measured ~14 MiB compressed size, Google list prices for `us-east1`:

| Item | Estimate |
|---|---|
| GCS Standard + 7-day soft delete (≤0.3 GiB steady) | ≈ $0.01 |
| Cloud Run Job (30 × ~15 s × 1 vCPU / 512 MiB) | ≈ $0.01–0.02 |
| Secret Manager (1 secret) | $0.06 |
| Cloud Scheduler (1 job; 3 jobs/month free) | $0.00 |
| Artifact Registry (~0.2 GiB image; 0.5 GiB free) | $0.00 |
| Logging / Monitoring (under free tiers) | $0.00 |
| Cloud Build (one-time; free daily minutes) | ≈ $0.00 |

**About $0.08–$0.20 per month.** Storage stays cheap even if the database grows several times; Cloud Run and Secret Manager dominate this tiny bill. A static-IP VPC/NAT design was not added (plan requires owner approval and would raise cost).

## How to find the newest verified backup

```bash
gcloud storage ls --long --recursive \
  gs://vantage-mongodb-backups-496816/backups/mongodb/vantagemovers/daily/
```

The newest restore point is the lexicographically greatest timestamped object under that prefix. Confirm it with the matching `*.success.json` under `.../manifests/`.

## Deviations from the plan

1. Tools SHA-256 was pinned from the official `fastdl.mongodb.org` tarball (`15b3562b13ff9aac3baa2594c705ea0ac3597f4b85c7653f17efcd36e8588678`). MongoDB does not publish a sidecar `.sha256` for this artifact (HTTP 403).
2. Freshness alert uses 23h30m, the Monitoring absence maximum. The plan asked for 26h.
3. Two scheduler-triggered executions were created during the handoff trigger (plus the manual first run). All three archives coexist.
4. Restore drill used a local disposable `mongod` because Docker Desktop was not running.
5. Runtime delete was proven by IAM (no object-delete role), not by impersonated `gcloud storage rm` (provisioning identity was not granted token creator on the runner SA).
6. Cloud Build’s default compute SA received `roles/storage.objectAdmin` on `gs://vantage-sheets-496816_cloudbuild` only, so it can read source tarballs.
7. Existing dirty worktree files were left untouched. New files are under `scripts/cloud/mongodb-backup/` and this record.
