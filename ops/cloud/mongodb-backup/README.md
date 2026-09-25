# vantage-mongodb-backup

Standalone Cloud Run Job that takes a daily logical `mongodump` of `vantagemovers` and stores an immutable gzip archive in `gs://vantage-mongodb-backups-496816`.

The job never deletes previous archives. GCS prefix-scoped lifecycle rules expire daily objects after 8 days and weekly objects after 29 days.

## Local tests

```bash
npm test
```

Tests use fakes. They do not contact MongoDB or GCS.

## Required runtime configuration

Secret (Secret Manager → Cloud Run Job):

- `MONGO_URI`

Plain environment:

- `MONGO_DATABASE=vantagemovers`
- `BACKUP_BUCKET=vantage-mongodb-backups-496816`
- `BACKUP_SCHEMA_VERSION=1`
- `MONGO_TOOLS_VERSION=100.17.0`
- `TZ=America/New_York`

## Handoff commands

```bash
PROJECT=vantage-sheets-496816
REGION=us-east1

gcloud run jobs executions list \
  --job=vantage-mongodb-backup \
  --region="$REGION" \
  --project="$PROJECT"

gcloud storage ls --long --recursive \
  gs://vantage-mongodb-backups-496816/backups/mongodb/vantagemovers/daily/

gcloud storage objects describe \
  "gs://vantage-mongodb-backups-496816/<exact-object-name>" \
  --format=json

gcloud scheduler jobs describe vantage-mongodb-backup-daily \
  --location="$REGION" \
  --project="$PROJECT"
```

Newest verified daily archive: the lexicographically greatest object under `backups/mongodb/vantagemovers/daily/`, confirmed by the matching `*.success.json` manifest.

OKF Service (invariants): [`docs/knowledge/services/mongodb-backup.md`](../../../docs/knowledge/services/mongodb-backup.md).  
Operator playbook: [`docs/mongodb-backup-automation/README.md`](../../../docs/mongodb-backup-automation/README.md).  
Deployment evidence: [`docs/mongodb-backup-automation/deployment-record.md`](../../../docs/mongodb-backup-automation/deployment-record.md).

## Restore drill (isolated only)

Never restore into production and never use `--drop` against `vantagemovers`.

```bash
gcloud storage cp \
  "gs://vantage-mongodb-backups-496816/<exact-object-name>" \
  ./restore.archive.gz

# verify SHA-256 against the object custom metadata / success manifest
mongorestore \
  --archive=./restore.archive.gz \
  --gzip \
  --nsFrom='vantagemovers.*' \
  --nsTo='restore_probe.*'
```
