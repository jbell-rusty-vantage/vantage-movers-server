---
type: Service
title: MongoDB backup
description: Daily logical mongodump of vantagemovers to an immutable GCS archive in the vantage-sheets GCP project.
tags: [mongodb-backup, operations]
status: draft
stale_after: 2026-10-01
resource: scripts/cloud/mongodb-backup/backup.mjs
applies_to:
  - scripts/cloud/mongodb-backup/backup.mjs
  - scripts/cloud/mongodb-backup/backup.test.mjs
  - scripts/cloud/mongodb-backup/Dockerfile
  - scripts/cloud/mongodb-backup/lifecycle.json
owners: [team:main-server]
sources:
  - id: primary
    resource: scripts/cloud/mongodb-backup/backup.mjs
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
  - id: adr-0001
    resource: ../docs/adr/0001-mongodb-system-of-record.md
  - id: playbook
    resource: docs/mongodb-backup-automation/README.md
    title: Operator playbook
  - id: deployment-record
    resource: docs/mongodb-backup-automation/deployment-record.md
generated:
  by: process:docs-keeper
  at: 2026-09-01T18:40:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**ADRs:** [`../../../../docs/adr/`](../../../../docs/adr/) — [0001 Mongo SoR](../../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `scripts/cloud/mongodb-backup/backup.mjs`  
**Domain terms used:** [System of Record](../../../../CONTEXT.md)  
**Operator playbook:** [`../../mongodb-backup-automation/README.md`](../../mongodb-backup-automation/README.md)  
**Related rule:** [`mongodb-backup.mdc`](../../../.cursor/rules/mongodb-backup.mdc)

# MongoDB backup

**Role:** Protect the production [System of Record](../../../../CONTEXT.md) (`vantagemovers`) with a daily logical `mongodump`. Archives live in **Google Cloud Storage** in project `vantage-sheets-496816`. This is not AWS S3, not Vercel Blob, and not the existing Sheets bucket `gs://vantage-sheets-496816/`.

Atlas may run on AWS. That is MongoDB Atlas hosting. Backup objects are `gs://vantage-mongodb-backups-496816/...`.

This job does not run inside the Express API. Vercel write paths are unchanged.

## Trigger

| Path | What happens |
|---|---|
| Cloud Scheduler `vantage-mongodb-backup-daily` | `15 2 * * *` `America/New_York` → Cloud Run Job `vantage-mongodb-backup` |
| Manual `gcloud run jobs execute` or `gcloud scheduler jobs run` | Same job, new timestamped objects |
| Sunday in `America/New_York` | After daily verify, server-side copy to `weekly/` |

## Invariants

- Database name must be `vantagemovers`. Any other name refuses to run.
- URI is injected from Secret Manager `vantage-production-mongo-uri`. Never a Cloud Run plain-text env, build arg, or argv.
- Upload uses `ifGenerationMatch: 0`. Name collision fails; it does not overwrite.
- Success manifest is written only after dump, upload, metadata verify, and any required weekly copy succeed.
- The runtime identity cannot delete objects. GCS lifecycle expires `daily/` and `manifests/` at 8 days and `weekly/` at 29 days. Soft delete is 7 days.
- No `latest.archive.gz`. Newest verified daily archive is the lexicographically greatest object under `backups/mongodb/vantagemovers/daily/`, confirmed by the matching `*.success.json`.
- Restore never targets production and never uses `--drop` against `vantagemovers`. Remap to an isolated database.

## Object layout

```text
gs://vantage-mongodb-backups-496816/backups/mongodb/vantagemovers/
  daily/schema-v1/YYYY/MM/DD/vantagemovers-<UTC>-tools-100.17.0.archive.gz
  weekly/schema-v1/<ISO-year>/<ISO-week>/...
  manifests/schema-v1/YYYY/MM/DD/vantagemovers-<UTC>.success.json
```

Daily path dates are UTC. Weekly classification uses `America/New_York`.

## Interact

Project `vantage-sheets-496816`, region `us-east1`. Commands are in the [playbook](../../mongodb-backup-automation/README.md). Short form:

1. List daily archives: `gcloud storage ls --long --recursive gs://vantage-mongodb-backups-496816/backups/mongodb/vantagemovers/daily/`
2. List executions: `gcloud run jobs executions list --job=vantage-mongodb-backup --region=us-east1`
3. Run now: `gcloud scheduler jobs run vantage-mongodb-backup-daily --location=us-east1`
4. Restore drill: download one generation, check SHA-256 against the manifest, `mongorestore --gzip --nsFrom='vantagemovers.*' --nsTo='restore_probe.*'` into a disposable MongoDB.

Local package tests: `cd scripts/cloud/mongodb-backup && npm test` (fakes only).

## Not this service

- Application Mongo writes, Sheet Sync, Reporting, or Granot lifecycle
- Historical / `testvantagemovers` dumps
- Widening the Atlas IP allowlist or adding VPC/NAT (owner approval; changes cost)
