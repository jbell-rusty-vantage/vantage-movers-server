# Granot Dashboard server handoff

The Granot HTTP collector and dashboard workflow are integrated server
features. They are mounted in `src/app.ts`, protected by API-secret plus signed
Owner actor authentication, backed by `granot_automation_runs`, and woken in
production through the Vercel Queue consumer with a cron recovery heartbeat.

## Module map

- `index.ts`: bounded same-origin Granot HTTP session and HTML report parser.
- `automation.ts`: legacy direct collect/call-preview orchestration retained
  for compatibility and focused collector tests.
- `formWorkflow.ts`: form parser, strict identity resolution, immutable
  actions, and safe patch planning.
- `runWorkflow.ts`: durable create/plan/approve/apply/recovery interface,
  checksum verification, fenced lease, checkpoints, receipts, expiry and
  deployment gate.
- `src/models/GranotAutomationRun.ts`: durable run schema.
- `src/routes/granot-automation.routes.ts`: admin HTTP contract.
- `api/queues/granot-automation-consumer.ts`: production wake-up consumer.
- `docs/granot-http-automation.md`: operator contract and environment setup.

## Invariants

- Operation is always explicit: `form_leads` or `call_leads`.
- Call-lead modules receive only their existing row payloads; `ref_no` is not
  mapped or used by that path.
- Form exact identity is only `Granot ref_no === FormLead.ref_no`. Never add
  `_id`, `lid`, or `normalized_lid` interpretations.
- `duplicate: true` records remain quarantined.
- Plans are immutable after `plan_locked_at`; approval binds selected actions
  to the exact checksum.
- Apply requires `GRANOT_AUTOMATION_APPLY_ENABLED=true`, an unexpired plan,
  the fenced account lease, matching expected canonical values, and a receipt
  checkpoint per selected action.
- Form writes cross the canonical `updateFormLead` seam so booking refresh and
  sheet-sync effects remain intact. Call writes re-preview their target and
  approved change set immediately before sync and emit drift receipts when the
  binding changed.
- Persist only parsed plan data and summaries. Never persist provider HTML,
  cookies, session UUIDs, or credentials.
- Mongo TTL removes durable plans after seven days.
- Default run reads are redacted. Owner detail is opt-in with
  `?details=owner`.

## Verification

```bash
pnpm test:granot
pnpm typecheck
```

For endpoint examples and stable errors, see
`docs/granot-http-automation.md`.
