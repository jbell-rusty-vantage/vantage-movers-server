# Granot Dashboard workflow

> Compact current invariants: [`.cursor/businesslogic/granotHttpCollector.service.md`](../../.cursor/businesslogic/granotHttpCollector.service.md). Apply still mutates domain services directly; it does not write `GranotObservationReceipt`.

The server collects Granot Leads & Advertising reports through the protected
Node HTTP collector, then creates a durable Mongo-backed preview/apply run.
Every request explicitly chooses `form_leads` or `call_leads`; the call path
continues to use the existing enrichment and booked-reconciliation modules and
never interprets Granot `ref_no`.

## Endpoint contract

All endpoints require `x-api-secret: $VANTAGE_API_SECRET` plus the signed Owner
actor headers emitted by Vantage Admin. Extension bearer users, scoped keys,
Admins, and unsigned callers cannot read plans or operate runs.

### Create and plan a run

`POST /api/v1/admin/granot-automation/runs`

```json
{
  "operation": "form_leads",
  "workflow": "apply",
  "from": "08/03/2026",
  "to": "08/04/2026",
  "source_labels": ["TBM Forms Prime"],
  "filters": {
    "date_factor": "OPEN",
    "type": "ALL",
    "department": "",
    "state": "",
    "status": "10"
  }
}
```

Returns `202` with `run_id`, `status`, and `queue_published`. Production sends
a tiny wake-up to `granot-automation-events`; Mongo owns the durable work.
Local creation executes the worker directly.

`workflow: "preview"` locks a plan and completes without mutation.
`workflow: "apply"` locks the plan and enters `awaiting_approval`.
New callers should submit `source_ids`; `source_labels` remains a compatibility
path for existing scripts.

### Create one or both Lead workflows

`POST /api/v1/admin/granot-automation/run-groups`

```json
{
  "operations": ["form_leads", "call_leads"],
  "workflow": "apply",
  "from": "08/03/2026",
  "to": "08/04/2026",
  "source_ids": ["<form source id>", "<call source id>"]
}
```

The server resolves and partitions source IDs from the catalog, validates every
partition before writing, and atomically creates one independently reviewable
durable run per operation. Child runs share `run_group_id`; approvals,
checksums, actions, and receipts remain isolated.

### Source catalog

- `GET /api/v1/admin/granot-automation/runs/sources`
- `GET /api/v1/admin/granot-automation/runs/sources?operation=form_leads`
- `POST /api/v1/admin/granot-automation/runs/sources`

Source creation requires an exact label plus one or two unique supported Lead
workflows:

```json
{
  "label": "Example Exact Label",
  "supported_operations": ["form_leads", "call_leads"]
}
```

### List or inspect

- `GET /api/v1/admin/granot-automation/runs?limit=25`
- `GET /api/v1/admin/granot-automation/runs/:runId`
- `GET /api/v1/admin/granot-automation/runs/:runId?details=owner`

Default responses contain counts, hashes, status, checksum, checkpoint, and
receipt count. `details=owner` includes immutable plan actions and receipts and
can contain lead data; use it only in the owner admin UI.

### Approve selected actions

`POST /api/v1/admin/granot-automation/runs/:runId/approve`

```json
{
  "plan_checksum": "<64 lowercase/uppercase hex characters>",
  "selected_action_ids": ["TBM Forms Prime:followUpEstimates:1:90002"]
}
```

Approval requires an unexpired `awaiting_approval` run, the exact immutable
plan checksum, known action IDs, and
`GRANOT_AUTOMATION_APPLY_ENABLED=true`. Local approval invokes the worker
directly; production publishes a queue wake-up.

### Worker and recovery

`POST /api/v1/admin/granot-automation/runs/worker`

```json
{ "action": "execute" }
```

Use `"recover"` to publish a wake-up for recoverable queued/applying/expired-
lease work. `execute` directly claims one durable run and is intended for
local operations and controlled recovery.

Stable errors use `{ "ok": false, "code": "...", "error": "..." }`.
Validation is `400`, state/checksum/gate conflicts are `409`, missing runs are
`404`, provider failures are `502`, and unexpected failures are `500`.

## Form identity and mutation rules

1. Granot `ref_no` is compared exactly to Mongo `FormLead.ref_no`.
2. After an exact field miss, an ObjectId-shaped Granot `ref_no` is resolved
   against Mongo `_id` for compatibility with historical rows. `lid` and
   `normalized_lid` are never matching keys.
3. Multiple non-quarantined exact refs are a conflict. Records with
   `duplicate: true` are excluded from all matching and applying.
4. Fallback uses phone/email/name search, hard-filters candidates to the
   Granot source's canonical `source_company`, then applies score and
   quoted/prior tie-breaks. Phone or email is required; name is supplemental.
   Unknown or cross-source candidates cannot update.
5. Prior `1` or `5` sets quoted and valid cubic feet.
6. Pickup/delivery city, state, and ZIP values fill only empty compatible
   canonical fields.
7. Receiver agent is set only when empty and the CRM username uniquely
   resolves.
8. Apply rechecks expected field values and duplicate quarantine. Drift yields
   a receipt rather than overwriting newer data. Replayed actions are skipped
   using durable receipts.

## Safety and configuration

Required:

```text
GRANOT_NETWORK_USERNAME
GRANOT_NETWORK_PASSWORD
GRANOT_USERNAME
GRANOT_PASSWORD
VANTAGE_API_SECRET
VANTAGE_ADMIN_PROXY_SIGNING_SECRET
MONGODB_URI
CRON_SECRET
```

Apply gate:

```text
GRANOT_AUTOMATION_APPLY_ENABLED=true
```

`VANTAGE_ADMIN_PROXY_SIGNING_SECRET` must match Vantage Admin. `CRON_SECRET`
protects the five-minute recovery heartbeat. Durable plans are automatically
deleted after seven days.

The collector keeps cookies and session UUIDs only in memory. Raw HTML,
cookies, UUIDs, and credentials are never persisted in runs or returned.
Source reports are sequential, same-origin, size-bounded, timeout-bounded, and
retry one complete login after invalid-session detection.

Local redacted collection remains available:

```bash
pnpm granot:collect --from 08/03/2026 --to 08/04/2026 --discover
pnpm granot:collect --from 08/03/2026 --to 08/04/2026 --source "TBM Forms"
```

Focused verification:

```bash
pnpm test:granot
pnpm typecheck
```
