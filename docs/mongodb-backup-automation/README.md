---
type: Playbook
title: MongoDB backup operator playbook
description: How to list, trigger, inspect, and restore-drill vantageovers backups in the vantage-sheets GCP project.
tags: [mongodb-backup, operations]
status: draft
stale_after: 2026-10-01
resource: docs/knowledge/services/mongodb-backup.md
applies_to:
  - docs/knowledge/services/mongodb-backup.md
  - scripts/cloud/mongodb-backup/backup.mjs
owners: [team:main-server]
sources:
  - id: service
    resource: docs/knowledge/services/mongodb-backup.md
  - id: deployment-record
    resource: docs/mongodb-backup-automation/deployment-record.md
generated:
  by: process:docs-keeper
  at: 2026-09-01T18:40:00Z
---

# MongoDB backup — operator playbook

Invariants live in [`docs/knowledge/services/mongodb-backup.md`](../knowledge/services/mongodb-backup.md). First-deploy evidence lives in [`deployment-record.md`](./deployment-record.md). The implementation plan is historical: [`cloud-run-job-implementation-plan.md`](./cloud-run-job-implementation-plan.md).

**Storage is Google Cloud Storage** in project `vantage-sheets-496816`. Prefix `gs://`. This is not an AWS S3 bucket and does not use a personal AWS account.

| Constant | Value |
|---|---|
| Project | `vantage-sheets-496816` |
| Region | `us-east1` |
| Bucket | `gs://vantage-mongodb-backups-496816` |
| Job | `vantage-mongodb-backup` |
| Scheduler | `vantage-mongodb-backup-daily` (`15 2 * * *` `America/New_York`) |
| Secret | `vantage-production-mongo-uri` (do not print the payload) |

```bash
PROJECT=vantage-sheets-496816
REGION=us-east1
```

## Find the newest verified backup

```bash
gcloud storage ls --long --recursive \
  gs://vantage-mongodb-backups-496816/backups/mongodb/vantagemovers/daily/
```

Newest daily restore point = lexicographically greatest timestamped object. Confirm with the matching `*.success.json` under `.../manifests/`.

```bash
gcloud storage objects describe \
  "gs://vantage-mongodb-backups-496816/<exact-object-name>" \
  --format=json
```

Custom fields include `sha256`, `size_bytes`, `database`, `retention_class`, and `execution_id`.

## See whether it ran

```bash
gcloud run jobs executions list \
  --job=vantage-mongodb-backup \
  --region="$REGION" \
  --project="$PROJECT"

gcloud scheduler jobs describe vantage-mongodb-backup-daily \
  --location="$REGION" \
  --project="$PROJECT"
```

Structured logs use events `backup.started`, `dump.completed`, `upload.completed`, `verification.completed`, `weekly_copy.completed`, `backup.succeeded`, `backup.failed`. They must not contain the Mongo URI.

## Run a backup now

```bash
gcloud scheduler jobs run vantage-mongodb-backup-daily \
  --location="$REGION" \
  --project="$PROJECT"
```

Or `gcloud run jobs execute vantage-mongodb-backup --region="$REGION" --project="$PROJECT" --wait`.

A new run must create a new timestamped archive. It must not replace an older object.

## Restore drill (isolated only)

Never restore into Atlas `vantagemovers`. Never `--drop` against production.

1. Copy one object generation locally.
2. Compare SHA-256 to the object custom metadata / success manifest.
3. Restore with Database Tools `100.17.0` into a disposable MongoDB:

```bash
mongorestore \
  --archive=./restore.archive.gz \
  --gzip \
  --nsFrom='vantagemovers.*' \
  --nsTo='restore_probe.*'
```

4. Compare collection count and a few count-only aggregates. Delete the local archive and probe data afterward.

## Pause or roll back the schedule

```bash
gcloud scheduler jobs pause vantage-mongodb-backup-daily \
  --location="$REGION" \
  --project="$PROJECT"
```

Existing GCS objects stay until lifecycle expires them. Pausing does not delete backups.

## Alerts

- `vantage-mongodb-backup execution failed`
- `vantage-mongodb-backup freshness missing` (23h30m absence; Monitoring maximum)

Notification channel: project-owner email on `vantage-sheets-496816`. Do not put secret values in alert text.

## Local job package

```bash
cd scripts/cloud/mongodb-backup
npm test
```

Fakes only. Do not point local `npm start` at production unless you intend a real dump and have ADC for the dedicated bucket.
