# MongoDB Backup Automation - Cloud Run Job Implementation Plan

## Mission

Implement, deploy, and schedule a production-safe daily `mongodump` for the `vantagemovers` MongoDB database. Store each successful dump as an immutable, timestamped GCS object, retain at least seven daily restore points plus four weekly restore points, and never delete the previous successful backup as part of the job.

This plan authorizes the implementing agent to add the backup job code to this repository and create the required Google Cloud resources in project `vantage-sheets-496816`. It does **not** authorize edits or deletes in MongoDB, changes to the existing application write paths, deletion of existing GCS exports, or broadening Atlas network access.

## Read this first

Before making changes:

1. Read `AGENTS.md`, `CLOUD_AGENTS.md`, and the applicable `.cursor/rules/*.mdc` files.
2. Run `git status --short`. Preserve the user's existing dirty worktree and do not modify unrelated files.
3. Confirm the active gcloud project and identity:

   ```bash
   gcloud config get-value project
   gcloud auth list --filter=status:ACTIVE
   ```

4. Use project `vantage-sheets-496816`. Do not deploy into another project.
5. Do not print, commit, log, or pass the Mongo URI as a command-line literal.

## Verified starting state

- Production database: `vantagemovers` (`TEST_MODE=false`).
- Current database size: approximately 84.8 MiB logical data.
- Current contents: 52 collections and 124,143 documents as of August 3, 2026.
- Expected first compressed archive: roughly 20-70 MiB; record the actual result after deployment.
- Existing bucket `gs://vantage-sheets-496816/` is readable by the current gcloud service account.
- The existing bucket has uniform bucket-level access and seven-day soft delete, but its legacy policy allows project viewers to read objects. Do **not** place full production dumps there.
- Storage APIs are enabled.
- Cloud Run, Secret Manager, and IAM APIs were not enabled at the time this plan was written. Cloud Scheduler also had no established location.

## Target architecture

```text
Cloud Scheduler (02:15 America/New_York)
                  |
                  v
Cloud Run Job: vantage-mongodb-backup
  - one task, one attempt plus one retry
  - Mongo URI injected from Secret Manager
  - mongodump 100.17.0 creates /tmp/*.archive.gz
  - application calculates SHA-256
  - application uploads with ifGenerationMatch=0
  - application reads object metadata back and verifies it
  - Sunday runs also copy the verified object to weekly/
                  |
                  v
Regional GCS bucket: vantage-mongodb-backups-496816
  - daily objects expire after 8 days
  - weekly objects expire after 29 days
  - seven-day soft delete remains enabled
  - lifecycle performs deletion; runtime identity cannot delete objects
```

The newest successful archive is the lexicographically greatest timestamped object under the `daily/` prefix. Do not maintain a mutable `latest.archive.gz`; immutable names and a unique success manifest avoid granting the runtime account object-delete permission.

## Fixed resource names

Use these names unless one is already occupied by an unrelated resource. Record any necessary deviation in the deployment record.

| Resource | Name |
|---|---|
| Project | `vantage-sheets-496816` |
| Project number | `412588647450` |
| Default region | `us-east1` |
| Backup bucket | `vantage-mongodb-backups-496816` |
| Artifact Registry repository | `vantage-operations` |
| Cloud Run Job | `vantage-mongodb-backup` |
| Runtime service account | `mongodb-backup-runner` |
| Scheduler service account | `mongodb-backup-scheduler` |
| Secret | `vantage-production-mongo-uri` |
| Scheduler job | `vantage-mongodb-backup-daily` |
| Database Tools version | `100.17.0` |
| Backup schema | `schema-v1` |

`us-east1` is the working default. Before creating regional resources, check the Atlas provider and region. If Atlas is demonstrably in another North American region, use the nearest matching GCP region for the bucket, Cloud Run Job, Artifact Registry, and Scheduler. Do not guess across continents. Record the chosen region and reason.

## Object layout

```text
gs://vantage-mongodb-backups-496816/
  backups/mongodb/vantagemovers/
    daily/schema-v1/YYYY/MM/DD/
      vantagemovers-YYYYMMDDTHHMMSSZ-tools-100.17.0.archive.gz
    weekly/schema-v1/YYYY/WW/
      vantagemovers-YYYYMMDDTHHMMSSZ-tools-100.17.0.archive.gz
    manifests/schema-v1/YYYY/MM/DD/
      vantagemovers-YYYYMMDDTHHMMSSZ.success.json
```

Required archive custom metadata:

- `source=mongodb`
- `kind=logical-full-backup`
- `database=vantagemovers`
- `format=mongodump-archive-gzip`
- `backup_schema_version=1`
- `mongo_tools_version=100.17.0`
- `created_at=<UTC ISO-8601>`
- `retention_class=daily|weekly`
- `sha256=<lowercase hex>`
- `size_bytes=<integer>`
- `owner=vantage`
- `execution_id=<Cloud Run execution identifier when available>`

The success manifest must contain the archive object name, object generation, size, SHA-256, creation time, tools version, database, retention class, duration, and verification result. Never include the Mongo URI, credentials, or customer data in metadata or manifests.

## Repository implementation

Create a committed, standalone job package at:

```text
scripts/cloud/mongodb-backup/
  Dockerfile
  .dockerignore
  package.json
  package-lock.json
  backup.mjs
  backup.test.mjs
  lifecycle.json
  README.md
```

Do not put this under `scripts/dev_ops/`; that path is ignored and intended for local-only destructive utilities.

### Container

- Use a small pinned Node 22 Debian image.
- Download the official Debian 12 x86_64 MongoDB Database Tools `100.17.0` archive during the image build.
- Verify the archive against a pinned SHA-256 obtained from an official MongoDB source. Fail the build on mismatch.
- Copy only the standalone job package into the image. The `.dockerignore` must exclude `.env*`, credentials, repository outputs, and unrelated source.
- Run as a non-root user.
- Do not install or embed the full Google Cloud CLI in the runtime image.
- Use `@google-cloud/storage` with Application Default Credentials for GCS operations.

### Job behavior

`backup.mjs` must:

1. Validate required configuration before connecting:
   - `MONGO_URI` secret is present.
   - `MONGO_DATABASE=vantagemovers`.
   - `BACKUP_BUCKET=vantage-mongodb-backups-496816`.
   - `BACKUP_SCHEMA_VERSION=1`.
   - `MONGO_TOOLS_VERSION=100.17.0`.
   - `TZ=America/New_York` for weekly classification only; object timestamps remain UTC.
2. Create a unique UTC timestamp and archive path under `/tmp`.
3. Write a temporary mode-`0600` mongodump YAML config containing the URI from `MONGO_URI`. Encode the URI safely as a YAML string and remove this file in `finally`.
4. Spawn `mongodump` without putting the URI in the process arguments and without logging its environment:

   ```text
   mongodump --config=<mode-0600 temp config> --db=vantagemovers --archive=<tmp file> --gzip
   ```

5. Stream child stdout/stderr through a redactor that removes URI-like values and credentials. Prefer suppressing verbose tool output.
6. Fail immediately on a non-zero exit, missing archive, or zero-byte archive. Do not upload a manifest on failure.
7. Calculate SHA-256 and local byte length.
8. Upload the daily archive with `ifGenerationMatch: 0`. An object-name collision must fail rather than overwrite.
9. Fetch GCS metadata after upload and compare the recorded object size and custom metadata to local values.
10. If the run date in `America/New_York` is Sunday, perform a server-side GCS copy of the verified daily object to the weekly prefix, also with a create-only precondition. Preserve provenance in metadata.
11. Upload a unique success manifest only after daily verification and any required weekly copy succeed.
12. Emit structured JSON logs for `backup.started`, `dump.completed`, `upload.completed`, `verification.completed`, `weekly_copy.completed`, `backup.succeeded`, and `backup.failed`.
13. Remove both the local archive and temporary config in a `finally` block.
14. Set a non-zero process exit code on every failure.

The runtime must never list and delete old archives. GCS lifecycle owns expiration, which guarantees that a timeout cannot remove the previous successful restore point.

### Tests

Use Node's built-in test runner. At minimum, cover:

- UTC daily object naming.
- New York Sunday/week classification around DST boundaries.
- Metadata and manifest serialization.
- Secret/URI redaction.
- Refusal to run with a non-production database name or missing required configuration.
- Zero-byte and failed-`mongodump` behavior.
- Upload precondition usage.
- No success manifest after a dump, upload, verification, or weekly-copy failure.
- Local temporary-file cleanup on success and failure.

Make cloud and process dependencies injectable so tests use fakes and do not contact MongoDB or GCS.

## GCP provisioning sequence

Run commands non-interactively with `--quiet` where supported. If the active identity lacks authority, stop and report the exact missing permission; do not repeatedly retry or reuse a broader existing service account.

### 1. Enable APIs

Enable:

```text
artifactregistry.googleapis.com
cloudbuild.googleapis.com
cloudscheduler.googleapis.com
iam.googleapis.com
run.googleapis.com
secretmanager.googleapis.com
```

Storage, Logging, Monitoring, Service Usage, and Cloud Resource Manager are already enabled, but verify them.

The provisioning identity may need Service Usage Admin, IAM Service Account Admin, Project IAM Admin, Artifact Registry Admin, Cloud Build Editor, Cloud Run Admin, Cloud Scheduler Admin, Secret Manager Admin, and Storage Admin. These are provisioning permissions only; do not grant them to the runtime identity.

### 2. Create the dedicated bucket

- Create `gs://vantage-mongodb-backups-496816` in the selected single region.
- Use Standard storage. Daily objects are too short-lived for Nearline, Coldline, or Archive minimum-duration pricing.
- Enable uniform bucket-level access.
- Enforce Public Access Prevention.
- Keep soft delete at seven days.
- Leave Object Versioning disabled because archive names are immutable and soft delete is enabled.
- Apply `scripts/cloud/mongodb-backup/lifecycle.json` only after reviewing its prefixes.

Lifecycle policy:

```json
{
  "rule": [
    {
      "action": { "type": "Delete" },
      "condition": {
        "age": 8,
        "matchesPrefix": [
          "backups/mongodb/vantagemovers/daily/",
          "backups/mongodb/vantagemovers/manifests/"
        ]
      }
    },
    {
      "action": { "type": "Delete" },
      "condition": {
        "age": 29,
        "matchesPrefix": [
          "backups/mongodb/vantagemovers/weekly/"
        ]
      }
    }
  ]
}
```

Lifecycle execution is asynchronous, so there may temporarily be more than seven daily or four weekly live objects. That is expected.

### 3. Create identities and least-privilege access

Create:

- `mongodb-backup-runner@vantage-sheets-496816.iam.gserviceaccount.com`
- `mongodb-backup-scheduler@vantage-sheets-496816.iam.gserviceaccount.com`

Grant the runtime account on the dedicated bucket only:

- `roles/storage.objectCreator`
- `roles/storage.objectViewer`

These permit immutable create, metadata verification, and the Sunday server-side copy without runtime delete permission. Confirm the copy operation succeeds with this combination before scheduling.

Grant the runtime account Secret Manager Secret Accessor on **only** `vantage-production-mongo-uri`. Grant normal Cloud Run logging permission if deployment does not supply it automatically.

Grant the scheduler account permission to invoke **only** the `vantage-mongodb-backup` job. Do not use the existing Sheets service account as either runtime or scheduler identity.

### 4. Create the secret safely

- Create Secret Manager secret `vantage-production-mongo-uri`.
- Add the existing production `MONGO_URI` as a secret version through stdin or a protected temporary file.
- Never place the URI directly in a gcloud command, checked-in file, build argument, Cloud Run plain-text environment variable, or terminal output.
- Verify only the secret name and enabled version state, never its payload.

If the agent cannot safely retrieve the production URI from the local ignored `.env`, stop and request that the owner add the secret version. Do not fabricate or reconstruct credentials.

### 5. Build and publish the image

- Create Artifact Registry Docker repository `vantage-operations` in the selected region.
- Build from `scripts/cloud/mongodb-backup/` only.
- Tag the image with the git commit and a human version, for example `v1-<short-sha>`; do not deploy mutable `latest` as the only reference.
- Scan build logs for accidental URI or credential output before deployment.
- Record the immutable image digest in the deployment record.

### 6. Create the Cloud Run Job

Deploy `vantage-mongodb-backup` with:

- Selected region, initially `us-east1`.
- Runtime service account `mongodb-backup-runner`.
- One task.
- Parallelism one.
- One vCPU.
- 512 MiB memory initially; increase only if the first run proves it necessary.
- 20-minute timeout.
- One retry.
- Mongo URI injected from Secret Manager as `MONGO_URI`.
- Non-secret configuration set as environment variables.
- No public HTTP service.
- No application source or credentials baked into the image.

Do not automatically widen the Atlas IP allowlist. If Cloud Run cannot reach Atlas, report that separately. A static egress design using VPC/NAT changes both security and monthly cost and requires owner approval.

### 7. Execute and validate manually

Run the job manually with `--wait` before creating the Scheduler job.

Validation gates:

1. Execution succeeds within the timeout.
2. No Mongo URI or credentials appear in build or runtime logs.
3. Exactly one daily archive and one success manifest appear for the execution.
4. Archive size is non-zero and plausible relative to the 84.8 MiB logical database.
5. Object metadata includes the required fields.
6. GCS object size and custom SHA-256 match the manifest.
7. The archive is stored only in the dedicated bucket.
8. Runtime service account cannot delete an archive.
9. Record actual compressed size, duration, and estimated monthly cost.

Perform a restore drill before calling the system production-ready:

- Download the exact archive generation.
- Verify SHA-256.
- Restore with MongoDB Database Tools 100.17.0 into an isolated disposable MongoDB deployment using namespace remapping.
- Compare collection count and a small set of non-sensitive aggregate counts.
- Never restore into production and never use `--drop` against production.

### 8. Create the Scheduler job

Only after the manual execution and restore drill pass, create `vantage-mongodb-backup-daily`:

- Schedule: `15 2 * * *`
- Time zone: `America/New_York`
- Location: the selected Cloud Run region.
- Target: Cloud Run v2 `jobs.run` endpoint for `vantage-mongodb-backup`.
- Authentication: OAuth using `mongodb-backup-scheduler`.

Trigger the Scheduler job once manually and confirm it creates a second valid restore point without overwriting the first.

## Observability and failure handling

The initial deployment must include:

- Structured Cloud Logging events from the job.
- An alert on failed Cloud Run Job executions.
- An alert or daily freshness check when no `backup.succeeded` event has occurred within 26 hours.
- A documented owner notification destination.

Important failure semantics:

- A failed run leaves every prior GCS object untouched.
- No pre-run delete is permitted.
- No lifecycle rule may match outside `backups/mongodb/vantagemovers/`.
- A weekly-copy failure fails the execution and does not publish the success manifest.
- Scheduler should retry through Cloud Run's configured retry only; avoid overlapping executions.

## Verification commands for handoff

The implementation README should provide commands equivalent to:

```bash
gcloud run jobs executions list \
  --job=vantage-mongodb-backup \
  --region="$REGION" \
  --project=vantage-sheets-496816

gcloud storage ls --long --recursive \
  gs://vantage-mongodb-backups-496816/backups/mongodb/vantagemovers/daily/

gcloud storage objects describe \
  gs://vantage-mongodb-backups-496816/<exact-object-name> \
  --format=json

gcloud scheduler jobs describe vantage-mongodb-backup-daily \
  --location="$REGION" \
  --project=vantage-sheets-496816
```

## Deliverables

The implementing Cursor agent must leave:

1. The standalone job package under `scripts/cloud/mongodb-backup/`.
2. Unit tests passing locally.
3. A successfully built, digest-pinned image in Artifact Registry.
4. The dedicated protected bucket and reviewed lifecycle rules.
5. Least-privilege runtime and scheduler service accounts.
6. Secret Manager secret wiring with no secret disclosure.
7. A manually verified Cloud Run Job execution.
8. A successful isolated restore drill.
9. An enabled daily Cloud Scheduler job.
10. Failure and freshness alerts.
11. `docs/mongodb-backup-automation/deployment-record.md` containing:
    - deployment date and operator;
    - region and Atlas-region rationale;
    - resource names;
    - image digest and tools version;
    - first archive object and generation;
    - actual compressed size and runtime;
    - restore-drill evidence;
    - retention and soft-delete settings;
    - estimated monthly cost;
    - any deviations from this plan.

## Definition of done

The work is complete only when a scheduled execution can create a new immutable full backup without deleting the previous one, the resulting archive has been restored successfully into an isolated environment, seven-daily/four-weekly retention is enforced by prefix-scoped lifecycle rules, secrets are absent from code and logs, and the owner has a documented command for finding the newest verified backup.
