# Best Relocation Stage 4: Google Delivery and Rollout

Status: implementation plan  
Source of truth: `docs/current_plans/best-relocation-ingestion-and-reporting-projection-spec.md`  
Stage: 4 of exactly 4  
Default business timezone: `America/New_York`

## 1. Purpose and ownership

Stage 4 completes the owner-facing reporting projection by connecting the
Stage 3 reporting core to owner OAuth, Google Picker, safe Google Drive/Sheets
destinations, durable delivery workers, the reporting admin experience, live
Google integration coverage, and production operations.

This is an implementation plan, not authorization to broaden the reporting
product. V1 remains manual-only. MongoDB production data remains canonical;
Google artifacts are non-canonical projections. Every delivery uses a previewed,
immutable `ReportingDefinitionRevision`. Neither this stage nor completion of
reporting authorizes the historical/production database merge or ingestion
activation.

The four implementation documents are:

1. `best-relocation-stage-1-shared-foundations.md`
2. `best-relocation-stage-2-ingestion.md`
3. `best-relocation-stage-3-reporting-core.md`
4. `best-relocation-stage-4-google-delivery-and-rollout.md` (this document)

Stage 1 owns shared run, lease, checksum, actor, audit, queue, retry, and the
single operational-workbook registry contract. Stage 2 owns ingestion and
contributes its two source registrations to that registry. Stage 3 owns
reporting datasets, canonical queries, immutable
definitions/revisions, preview computation, and the reporting persistence
contracts. This stage consumes those contracts and owns external delivery.

## 2. Entry criteria and dependencies

Implementation may start only after all of the following are available:

- Stage 1 is complete, including reusable durable-run transitions, atomic
  leases, checkpoint conventions, structured failures, bounded retries, actor
  snapshots, audit emission, and queue wake-up/idempotency patterns.
- Stage 3 is complete, including the three versioned dataset contracts,
  production-only canonical query execution, deterministic pagination and
  ordering, immutable definition revisions, preview checksum semantics,
  destination snapshot contract, PII classifications, and validated run
  snapshot inputs.
- Stage 2's two Best Relocation source registrations have been accepted into
  Stage 1's operational-workbook registry. Stage 2 does not need to be
  activated, scheduled, or ingesting.
- The reporting worker can obtain the complete current denylist from that one
  authoritative Stage 1 server-side interface. It must not reconstruct that
  list from Stage 2, admin form values, or a stale duplicate configuration.
- The production Google Cloud project, owner identity, redirect URIs, APIs,
  OAuth consent configuration, and deployment secrets can be configured in a
  non-production environment before rollout.

Reject Stage 4 entry if Stage 3 cannot resume a deterministic query from an
opaque cursor after the worker fixes the run's source-read-through and revision
snapshot, or if Stage 1's unified registry cannot enumerate all required
ingestion and operational workbooks, including Stage 2's two registrations.
Delivery correctness and destination safety cannot be repaired in the UI.

Ingestion activation is explicitly not an entry criterion. Reporting must not
wait for scheduled Best Relocation ingestion.

## 3. Scope

Stage 4 owns:

- owner-only Google OAuth connection, identity restriction, token health, and
  disconnect behavior;
- browser-safe Google Picker bootstrap and folder/spreadsheet selection;
- Drive folder and spreadsheet creation through owner OAuth;
- `ReportingDestination` creation, verification, update, archive/detach, and
  explicit managed-artifact cleanup;
- destination ownership markers and immutable Google file/tab identifiers;
- the complete operational-workbook hard denylist at both save and run time;
- `snapshot` and `replace_tab` delivery strategies;
- durable queued worker execution from canonical Mongo query pages to bounded
  Sheets writes;
- write checkpoints, provider retry handling, verification, promotion,
  compensation, and cleanup;
- owner-write/admin-read APIs and audit;
- owner reporting settings, destination, builder integration, preview
  confirmation, run, and history UI;
- alerts, retention, operational dashboards, live Google CI, staged rollout,
  rollback, and final owner/operations handoff.

## 4. Non-goals

Do not implement:

- scheduled, recurring, event-triggered, or webhook-triggered reports;
- arbitrary Mongo queries, user-defined joins, formulas, or unvetted model
  fields;
- key-based row upserts into existing tabs;
- broad whole-Drive browsing scopes;
- service-account reporting;
- writes to human-created tabs or takeover by matching a tab name;
- an owner override for the workbook denylist;
- a historical/production database union or historical database selector;
- complete report row copies in Mongo, logs, audit events, or checkpoint
  payloads;
- report-driven canonical writes, import behavior, or ingestion activation;
- inferred profit, revenue, or ROI measures;
- routine success notifications.

## 5. Non-negotiable safety invariants

1. Canonical report data comes only from the production MongoDB connection.
2. A preview does not write to Mongo canonical records, Drive, or Sheets.
3. Delivery uses exactly one immutable definition revision and its validated
   destination snapshot; editing creates a new revision.
4. The first delivery of every revision requires explicit owner confirmation
   of its preview. Later runs of the unchanged revision require a fresh
   volume/warning estimate in the run confirmation.
5. There is no silent truncation. Over-capacity output is rejected before
   external mutation with actionable row, column, cell, and limit details.
6. Only owner OAuth is used for reporting. The operational service account is
   never a fallback.
7. Destination and source records, permissions, tokens, workers, and audits
   remain separate from ingestion.
8. `replace_tab` can replace only a tab that Vantage created and marked for the
   same destination. A matching name is never proof of ownership.
9. A previously published managed tab remains usable until a fully written and
   verified replacement is ready.
10. Every destination mutation, revision, preview approval, run, cancellation,
    delivery, promotion, and cleanup records actor, timing, IDs, and outcome
    without PII.
11. Retries, duplicate queue deliveries, browser disconnects, and concurrent
    clicks cannot duplicate a promoted delivery.
12. PII may appear only in the authorized preview response and intended Google
    artifact. It is excluded from logs, audit payloads, provider error
    annotations, persisted preview metadata, and run checkpoints.

## 6. Environment, identity, scopes, and secret boundaries

### 6.1 Server-only configuration

Production requires:

```dotenv
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY=
GOOGLE_OAUTH_OWNER_EMAIL=
GOOGLE_OAUTH_REDIRECT_URI=
GOOGLE_OAUTH_COMPLETION_REDIRECT_URL=
GOOGLE_DRIVE_EXPORT_FOLDER_ID=
REPORTING_ENABLED_DATASETS=lead_outcome_detail,lead_quality_exceptions,source_performance
```

Optional hardening proposal, not a source-specification requirement: consider a
deployment-level delivery kill switch during rollout:

```dotenv
REPORTING_GOOGLE_DELIVERY_ENABLED=false
```

If approved and added to the authoritative specification, the kill switch blocks
destination mutation and new run creation without
altering definitions, revisions, destinations, or history. It is not a schedule
and is not owner-editable. Read-only health and history remain available while
false. Stage 4 completion and rollout must not depend on this key unless that
specification change is approved; without it, use the normal deployment rollback
and safely cancel queued/not-yet-writing runs.

Never send these values to a browser:

- OAuth client secret;
- refresh token or encrypted token payload;
- token encryption key;
- owner email enforcement details beyond the connected account's safe display
  identity;
- server callback validation state;
- service-account credentials;
- CI credentials.

Refresh tokens stay encrypted using the existing
`GoogleDriveConnection`/Google Drive OAuth conventions and are referenced, not
copied, by destinations and runs.

### 6.2 Browser-safe Picker configuration

Picker requires:

```dotenv
GOOGLE_PICKER_API_KEY=
GOOGLE_PICKER_APP_ID=
```

The Picker bootstrap response may contain only:

- browser-visible Picker API key;
- Picker application/project ID;
- a short-lived owner OAuth access token scoped to the requested flow;
- allowed Picker view/mime-type configuration;
- token expiry;
- a one-time, server-bound selection nonce;
- safe feature-availability and connection-health fields.

The endpoint must derive user identity from the trusted owner session, not a
request-supplied email. It must not return refresh credentials. Do not persist
the access token in browser storage, application logs, analytics, error
reporting, or Mongo.

### 6.3 Cloud project and scope

Enable Google Drive API, Google Sheets API, and Google Picker API in the
production Cloud project. Retain least-privilege `drive.file` access. Picker is
the mechanism that grants the application access to an arbitrary existing
owner-selected folder or spreadsheet; do not request broad Drive browsing
scope.

OAuth callback handling must:

1. validate signed/one-time state and trusted return target;
2. exchange the code server-side;
3. verify the Google account equals `GOOGLE_OAUTH_OWNER_EMAIL`;
4. encrypt and store the refresh token and safe identity snapshot;
5. reject missing refresh consent when no usable prior token exists;
6. audit success/failure without code, token, or PII leakage; and
7. redirect only to the configured completion URL.

Disconnect revokes or invalidates the reporting connection, blocks new
destination mutations/runs, and preserves audit/history. It does not delete
owner Drive artifacts.

## 7. Destination and ownership contract

### 7.1 Supported destination flows

The owner may:

- create a folder through Vantage;
- choose a Vantage-created folder;
- select and authorize an existing owner folder through Picker;
- create a named spreadsheet in an authorized folder;
- select an authorized existing spreadsheet for `replace_tab`; and
- choose the managed report tab name.

Every Picker selection is submitted to the server with its one-time nonce. The
server re-fetches file metadata through owner OAuth and validates file ID,
mime type, access, parent/folder relationship where relevant, ownership
expectation, trashed state, and denylist membership. Browser metadata is
untrusted display input.

### 7.2 `ReportingDestination` fields and snapshots

Persist:

- provider `google_sheets`;
- Google Drive connection reference, never credentials;
- owner identity snapshot;
- selected folder ID, display name, and URL;
- workbook ID, display name, and URL for `replace_tab`;
- immutable managed Google sheet/tab ID and display name;
- destination strategy and ownership policy;
- Vantage ownership marker/version;
- access/health status and last verification;
- archive state;
- created/updated actor and timestamps.

Definition revisions embed an immutable destination snapshot. A later rename
may update current display metadata but cannot rewrite a prior revision or run
snapshot. A changed workbook, strategy, folder, or managed tab requires a new
definition revision and preview.

### 7.3 Managed ownership invariants

For `replace_tab`:

- Vantage creates a new tab and attaches an ownership marker tied to the
  `ReportingDestination` ID and marker schema version.
- Persist the Google numeric sheet/tab ID. Names are display values only.
- Verify both tab ID and ownership marker before each staging/promotion flow.
- If the requested published name already belongs to any human-created or
  differently managed tab, reject and require another name.
- Never attach a Vantage marker to an existing human-created tab.
- If the managed tab is missing, copied, marker-mismatched, or moved to another
  workbook, mark destination unhealthy and require owner repair/recreation.
- Detach, delete, trash, or cleanup operations require explicit owner
  confirmation and an exact artifact preview.

For `snapshot`:

- each run creates a new immutable spreadsheet in the selected folder;
- name it from a sanitized definition name plus unique run timestamp/tag;
- never create snapshot output as a new tab in a shared workbook;
- record the created spreadsheet ID immediately for recovery;
- verify before marking delivery complete;
- trash incomplete workbooks on terminal failure, while retaining metadata
  about cleanup outcome.

### 7.4 Complete hard denylist

At destination creation/update, definition preview/save, run creation, and
immediately before the first provider write, reject a workbook ID found in the
authoritative denylist:

- every registered ingestion workbook, including both Best Relocation input
  workbooks;
- Master Leads;
- Master Booked;
- every configured source Sheet Sync target;
- every other operational projection workbook.

There is no owner override in v1. Compare immutable normalized Google file IDs,
not names or URLs. If the denylist cannot be loaded completely, fail closed.
Archive or reject a previously valid destination if it later becomes
operational. Audit the category and masked identifier, not sensitive sheet
content.

## 8. Durable worker state machine

### 8.1 Run states

Use Stage 3's `ReportingRun` states:

```text
queued -> querying -> writing -> verifying -> promoting -> completed
                 \         \          \           \-> failed
                  \---------\----------\--------------> cancelled
```

Transitions are compare-and-set and audited. `cancelled` is allowed only at a
documented safe point. `completed` is terminal and requires a verified
`ReportingDelivery`. Unexpected transitions fail the run rather than guessing.

Recommended durable phase/checkpoint fields:

- run/revision/destination snapshot checksums;
- lease owner, fencing token, and expiry;
- source read-through and deterministic query cursor;
- expected row/column/cell counts;
- deterministic checksum accumulator/version;
- strategy and created workbook/staging tab IDs;
- next write row and completed batch number;
- provider request, retry, and quota counters;
- verification results;
- promotion sub-step and old/new managed tab IDs;
- cancellation request time and actor;
- cleanup state and last structured error.

Checkpoints contain offsets, IDs, hashes, counters, and sanitized errors only,
never row payloads.

### 8.2 Queue and lease behavior

The run-now API:

1. authorizes owner;
2. checks the deployment delivery gate when the optional proposal in section
   6.1 has been approved and implemented;
3. loads the immutable revision and fresh estimate;
4. verifies preview approval and checksum;
5. validates the complete denylist and destination health;
6. creates exactly one queued run for the idempotency key;
7. captures actor and revision/destination snapshots; and
8. enqueues/wakes the dedicated reporting worker, then returns `202`.

The request does not query the full dataset or write Google. The worker obtains
and renews a Stage 1 lease with fencing. Duplicate consumers observe the active
lease and exit safely. A browser disconnect does not affect execution.

### 8.3 Querying and writing

The worker:

1. revalidates the immutable revision, destination snapshot, OAuth connection,
   denylist, and capacity estimate;
2. captures one immutable source-read-through instant;
3. obtains Stage 3's deterministic, resumable production-Mongo paginator;
4. creates the snapshot workbook or hidden staging tab and checkpoints its ID;
5. writes headers and data in bounded Sheets API batches;
6. updates the deterministic checksum in Stage 3's canonical serialization;
7. checkpoints only after Google acknowledges a complete batch;
8. resumes from the last acknowledged query cursor/write row after lease loss
   or retry; and
9. never creates one `SheetSyncJob` per report row.

Each batch is safe to replay by writing the same bounded staging range with the
same serialized values. On ambiguous provider timeout, read/verify the target
range or replay that same range; do not advance the checkpoint speculatively.

Refuse before artifact creation if actual projected cells exceed Google or
destination capacity. If the bound is discovered to be wrong during streaming,
stop, leave the published tab untouched, clean the incomplete artifact, and
return an actionable non-retryable capacity failure. Never cut rows to fit.

### 8.4 Retry classification

Retry only errors classified as transient by the shared provider convention,
including bounded quota/rate-limit and eligible 5xx/network failures. Honor
provider retry hints and use bounded exponential backoff with jitter.

Do not automatically retry:

- revoked/invalid OAuth requiring owner action;
- owner identity mismatch;
- access denied or file moved/trashed;
- denylist match or unavailable denylist;
- ownership marker mismatch;
- human-created name collision;
- invalid revision/checksum;
- capacity overflow;
- schema/header mismatch after deterministic rewrite;
- non-recoverable promotion ambiguity.

Persist sanitized provider code, phase, attempt count, and remediation category.
Never persist request cells or raw provider bodies that may contain PII.

### 8.5 Verification

Before promotion/completion, independently verify:

- expected header IDs/labels and ordering;
- exact row count;
- exact column and cell count;
- deterministic content checksum using the same canonical serialization/version;
- artifact workbook/tab IDs;
- destination and ownership marker;
- no truncation, duplicate header, or unexpected trailing managed values.

Record expected/actual values in `ReportingDelivery`. A mismatch is terminal
until a new retry/recovery run proves a clean artifact. It is never converted
to a warning.

## 9. Replace-tab staging, promotion, and recovery

### 9.1 Normal path

1. Verify the current published tab by immutable ID and ownership marker.
2. Create a uniquely named hidden staging tab with a run marker.
3. Checkpoint its ID before writes.
4. Write header/data batches and verify the complete staging tab.
5. In one Google batch update, rename the old managed tab to a unique recovery
   name and rename the staging tab to the published name.
6. Preserve both IDs and promotion response before changing destination state.
7. Verify the new published name, marker, visibility, counts, and checksum.
8. Atomically update the destination's managed tab ID to the promoted staging
   tab ID and complete the delivery.
9. Delete the old tab only after promotion verification, or retain it under the
   bounded cleanup policy.

The old and staging IDs must drive recovery; names alone never do.

### 9.2 Recovery decisions

- Failure before promotion: old published tab remains untouched; delete the
  failed staging tab if safe, otherwise enqueue bounded cleanup.
- Lease loss while writing: the next fenced worker inspects the checkpointed
  staging ID and resumes at the last acknowledged range.
- Timeout during rename batch: inspect both IDs, names, and markers before any
  retry. If staging is published and old is aside, continue verification. If
  old remains published and staging remains hidden, retry promotion. Any other
  state is a structured `promotion_ambiguous` failure requiring owner/operator
  review.
- Failure after rename but before destination update: recover from the delivery
  checkpoint, verify the promoted staging ID, then complete the destination
  compare-and-set.
- Failed post-promotion verification: retain both tabs, mark the delivery
  failed/ambiguous, alert operations, and do not delete the last known-good old
  tab.
- Cleanup failure: does not rewrite delivery truth. Record cleanup pending,
  retry separately, and alert after threshold.

### 9.3 Snapshot recovery

- Checkpoint the created workbook ID before content writes.
- Resume bounded writes against that exact workbook.
- On verification success, mark it complete and return its URL.
- On cancellation or terminal failure before completion, trash the incomplete
  workbook.
- If trash fails, record cleanup pending and let the janitor retry by immutable
  file ID and run marker.
- Never trash a workbook without a matching Vantage run marker.

## 10. APIs, authorization, and audit

All routes use trusted admin-proxy actor conventions. Owner mutations require
owner authorization server-side. Admin access is read-only and remains subject
to existing data access for preview samples.

### 10.1 OAuth and Picker

Extend the existing Google OAuth routes with:

```text
GET|POST /api/v1/admin/google-drive/oauth/...existing connect/callback/disconnect
POST     /api/v1/admin/google-drive/picker/bootstrap
POST     /api/v1/admin/google-drive/picker/selections/verify
```

Bootstrap accepts a narrow flow (`folder` or `spreadsheet`) and returns only the
browser-safe contract in section 6.2. Selection verification consumes the
nonce, re-fetches metadata, applies authorization/denylist checks, and returns
a short-lived server-side selection reference. It must not trust a Picker URL
as proof of access.

### 10.2 Reporting routes

Implement the relevant specification API surface:

```text
GET    /api/v1/admin/reporting/catalog

GET    /api/v1/admin/reporting/destinations
POST   /api/v1/admin/reporting/destinations
GET    /api/v1/admin/reporting/destinations/:id
PATCH  /api/v1/admin/reporting/destinations/:id
POST   /api/v1/admin/reporting/destinations/:id/verify
DELETE /api/v1/admin/reporting/destinations/:id

GET    /api/v1/admin/reporting/definitions
POST   /api/v1/admin/reporting/definitions
GET    /api/v1/admin/reporting/definitions/:id
POST   /api/v1/admin/reporting/definitions/:id/revisions
POST   /api/v1/admin/reporting/definitions/:id/preview
POST   /api/v1/admin/reporting/definitions/:id/run
POST   /api/v1/admin/reporting/definitions/:id/clone
DELETE /api/v1/admin/reporting/definitions/:id

GET    /api/v1/admin/reporting/runs
GET    /api/v1/admin/reporting/runs/:id
POST   /api/v1/admin/reporting/runs/:id/cancel
```

Stage 3 implements catalog/definition/query/preview behavior; Stage 4 wires
destination, run, cancellation, delivery progress, and artifact contracts
without duplicating Stage 3 validation.

Mutation requirements:

- optimistic revision/version preconditions for destination and definition
  changes;
- idempotency key for create/run/cancel/cleanup requests;
- explicit preview checksum and revision ID for first-delivery confirmation;
- fresh estimate acknowledgment for subsequent runs;
- explicit confirmation token for detach/delete/cleanup;
- `202` plus run ID for durable execution;
- structured, PII-safe errors and remediation categories.

### 10.3 Role matrix

Owner can:

- connect/disconnect OAuth and use Picker;
- create/archive/verify destinations;
- create/revise/archive/clone definitions;
- preview and approve a revision;
- run manually;
- request cancellation at safe points;
- explicitly detach or clean managed artifacts.

Admins can:

- read catalog, definitions, destination health, and immutable revision metadata;
- view authorized preview metadata/sample;
- view run/delivery progress, checksums, artifact links, and failures;
- never create external files, mutate destinations/definitions, approve
  previews, run/cancel reports, or clean artifacts.

Audit every OAuth connection state change, Picker selection verification,
destination mutation/verification, definition revision, preview approval, run,
cancel request/outcome, delivery, promotion, and cleanup. Audit identifiers,
checksums, counts, actor, and outcome; exclude exported rows, sample values,
tokens, customer PII, and raw provider bodies.

## 11. Admin UI implementation

### 11.1 Owner Google settings

Provide:

- connection status and safe connected-account display;
- configured/misconfigured health without exposing secret values;
- connect/reconnect/disconnect actions;
- Picker readiness and actionable API/scope errors;
- clear explanation that reporting uses owner OAuth, not ingestion credentials.

### 11.2 Destination manager

Provide:

- create or Picker-select folder;
- create or Picker-select spreadsheet for `replace_tab`;
- strategy selection and managed tab name;
- visible ownership policy, immutable artifact links, health, last verification,
  and denylist result;
- name-collision and capacity remediation;
- archive/detach/delete confirmation showing exact managed artifacts;
- no control that can override the hard denylist or claim a human tab.

### 11.3 Definition and preview flow

Integrate Stage 3's builder:

1. dataset;
2. lead cohort/date window and timezone;
3. hierarchical Source Company then Granularity selector using Operations
   Registry controls;
4. dataset-valid filters;
5. vetted columns, labels, ordering, and sort;
6. destination and `replace_tab | snapshot` strategy;
7. preview;
8. immutable revision save and first-run confirmation.

Preview must show exact/bounded count, 50 representative sample rows, columns
and cells, warnings, estimated batches, destination capacity, intended
workbook/tab changes, PII columns, owner identity/ownership, and preview
checksum. Label inclusive date input accurately while persisting Stage 3's
exclusive upper bound. The UI never silently clips samples into a delivery
limit or implies that preview rows are the full result.

### 11.4 Run experience

The confirmation dialog shows immutable revision, fresh estimate/warnings,
destination, strategy, expected mutations, and PII notice. Submission returns
immediately to run detail.

Run detail polls with bounded backoff and shows:

- queued/querying/writing/verifying/promoting/completed/failed/cancelled;
- rows/cells and batch progress;
- safe retry/provider counters;
- deterministic checksum and verification outcome;
- artifact link only when appropriate;
- structured failure and owner remediation;
- cancellation availability based on current safe point;
- cleanup pending/complete state.

Closing the page does not cancel a run. Admin versions of destinations,
definitions, preview, and history are read-only and hide owner actions.

## 12. Ordered, reviewable work packages

### WP4.1 — OAuth and configuration hardening

- Validate required server and browser-visible config separately.
- Harden owner account restriction, encrypted refresh-token lifecycle, callback
  state, completion redirect, token refresh health, disconnect, and audit.
- If separately approved in the authoritative specification, add and test the
  optional deployment delivery gate; this is not a Stage 4 acceptance
  prerequisite.
- Add tests proving secrets never enter API responses/log payloads.

Acceptance: owner OAuth works in a non-production Cloud project with
`drive.file`; wrong account and invalid state fail closed; no reporting path
uses the service account.

### WP4.2 — Picker bootstrap and selection verification

- Implement flow-scoped bootstrap and one-time nonce.
- Configure folder and spreadsheet Picker views.
- Verify selected IDs server-side and create expiring selection references.
- Exercise existing-file authorization under `drive.file`.

Acceptance: browser receives only approved fields; replayed/expired nonce,
wrong mime type, inaccessible file, or forged metadata is rejected.

### WP4.3 — Destination lifecycle and denylist

- Implement destination model/repository/service/routes from Stage 3 contract.
- Implement folder/spreadsheet creation and metadata refresh.
- Create managed tabs with durable ownership markers.
- Implement Stage 3's destination port using Stage 1's complete
  operational-workbook registry, including Stage 2's two accepted source
  registrations.
- Implement archive/detach/cleanup confirmations and audit.

Acceptance: denylist is enforced at every boundary, missing denylist fails
closed, and a human-created tab can never be claimed.

### WP4.4 — Google adapter and staging primitives

- Add bounded Sheets writes, Drive create/trash, tab create/hide/rename/delete,
  ownership marker inspection, and read-back verification.
- Reuse shared quota/retry classification without coupling to per-row Sheet
  Sync jobs.
- Sanitize provider telemetry.

Acceptance: adapter tests prove idempotent range replay, immutable ID use,
bounded retries, and no PII in errors.

### WP4.5 — Durable reporting worker

- Wire Stage 1 lease/queue/run conventions to Stage 3 paginator.
- Implement snapshot and replace-tab checkpoints.
- Implement checksum accumulation, cancellation safe points, verification, and
  terminal transitions.
- Make duplicate queue messages and lease takeover safe.

Acceptance: a killed worker resumes from checkpoint without duplicate rows or
deliveries, and no request lifecycle owns execution.

### WP4.6 — Promotion, compensation, and janitor

- Implement hidden staging and ID-based promotion.
- Implement ambiguous-promotion inspection and fail-safe recovery.
- Implement old-tab retention and bounded cleanup.
- Implement incomplete snapshot/staging janitor by run marker.

Acceptance: failed replacement preserves the prior tab; incomplete snapshots
are trashed; uncertain ownership never triggers deletion.

### WP4.7 — API and admin UI

- Complete reporting clients/routes and trusted proxy authorization.
- Build owner settings, destination manager, builder integration, preview
  confirmation, run history/detail, and read-only admin views.
- Add accessible loading/error/retry states and external-link safety.

Acceptance: owner-write/admin-read behavior is proven at server and UI layers;
refresh/disconnect does not affect durable runs.

### WP4.8 — Automated and live Google coverage

- Complete acceptance tests 10–19 below.
- Add dedicated OAuth-user live tests, content verification, cleanup, and
  janitor.
- Capture reproducible CI and staging evidence.

Acceptance: trusted live suite proves the owner OAuth/Picker/reporting route;
service-account-only proof is rejected.

### WP4.9 — Production rollout and operational handoff

- Deploy dark with delivery disabled.
- Connect owner, validate health, run canary snapshot and replace-tab reports,
  observe retry/cleanup/alerts, then enable owner access.
- Publish runbooks, dashboards, rollback, and evidence package.

Acceptance: owner and operations sign off against exit criteria; no ingestion
activation is bundled into rollout.

## 13. Tests and acceptance evidence

Stage 3 owns specification acceptance tests 1–9. Stage 4 must consume their
passing evidence and implement the following tests exactly:

10. denylisting every ingestion and operational workbook;
11. refusal to take over a human-created tab;
12. Google capacity feedback and no silent truncation;
13. worker pagination, lease, retry, and checkpoint resume;
14. deterministic ordering and checksum;
15. staging verification and promotion;
16. preservation of the prior tab on failed replacement;
17. incomplete snapshot cleanup;
18. owner-write/admin-read authorization; and
19. exclusion of PII from logs, audit payloads, and persisted preview metadata.

Add focused tests for:

- OAuth account restriction, state, token encryption, refresh, revoke, and
  secret redaction;
- Picker bootstrap field allowlist, token expiry, nonce replay, and forged
  selection metadata;
- `drive.file` access to created and Picker-selected artifacts;
- denylist changes between save and run, and denylist lookup failure;
- tab ownership marker/ID mismatch, copied tabs, and name collisions;
- duplicate run requests/queue messages and fenced lease takeover;
- retry-after ambiguous write and ambiguous promotion recovery;
- cancellation before creation, during writes, and after promotion begins;
- failed cleanup without loss of the last good artifact;
- admin mutation attempts through both API and UI;
- deployment gate behavior when the optional gate is adopted;
- retention/TTL and redaction.

### 13.1 Complete live Google CI contract

Live integration tests use:

- a dedicated test Google OAuth user;
- a dedicated test Cloud/OAuth configuration;
- a dedicated disposable export root;
- secrets restricted to trusted CI branches/environments;
- unique run-tagged artifact names;
- content verification;
- cleanup in `finally`; and
- a janitor for abandoned test artifacts.

Production owner OAuth credentials must never enter CI. A service account is
not an acceptable substitute.

The trusted live workflow must:

1. establish or refresh the dedicated OAuth user's reporting connection through
   the real owner-OAuth code path;
2. exercise Picker bootstrap and selection verification with the dedicated
   user and disposable root; where interactive Picker selection cannot run on
   every commit, run it as a protected browser E2E gate while every trusted CI
   run still validates bootstrap/token/selection server contracts;
3. create/select a disposable folder and spreadsheet;
4. prove a denylisted workbook is rejected;
5. create and verify a managed tab;
6. deliver known deterministic rows via replace-tab;
7. force a failed replacement and prove the prior tab remains;
8. create and verify a snapshot workbook;
9. exercise retry/resume against a controlled transient failure;
10. verify headers, rows, cells, checksum, marker, visibility, and artifact
    links through Google APIs;
11. trash/delete all run-tagged artifacts in `finally`; and
12. run a scheduled janitor that identifies only test-root artifacts with the
    test marker and age threshold.

CI logs expose only masked file IDs and run tags. Artifact names and fixture
content must contain synthetic data, not production PII. Live suite evidence
includes workflow URL/run ID, commit SHA, OAuth path exercised, created artifact
IDs in a restricted evidence record, content checksum, cleanup outcome, and
janitor status.

## 14. Alerts, retention, and operations

Notify the owner for:

- failed manual runs;
- OAuth refresh/revocation or provider authentication health failure;
- destination access/ownership health failure.

Emit operational events/alerts for:

- repeated transient-provider exhaustion;
- stuck leases or runs exceeding phase thresholds;
- verification or checksum mismatch;
- ambiguous promotion;
- cleanup backlog/janitor failure;
- denylist registry unavailable;
- unexpected capacity-estimate divergence.

Do not notify on routine success. Success remains visible in run history.

Retain indefinitely:

- immutable definition revisions;
- destination audit history;
- run/delivery metadata;
- checksums and verification;
- actor snapshots and timestamps.

Do not persist complete exported rows in Mongo. Persisted preview metadata is
PII-free; temporary preview samples and staging manifests use short documented
TTLs. Google artifact retention remains under owner Drive control. Cleanup
automation touches only positively marked Vantage-managed incomplete or
expired temporary artifacts.

Operations dashboards/runbooks must cover OAuth health, destination health,
run phase age, retry/quota counts, verification failures, promotion ambiguity,
cleanup backlog, live-test janitor, and the optional delivery gate when adopted.

## 15. Rollout

### Phase 0 — Configuration and dry deployment

- Deploy models, indexes, routes, worker, and UI without granting owner
  availability or creating runs; use the optional delivery gate only if it was
  approved.
- Enable Drive, Sheets, and Picker APIs and verify redirect origins/URIs.
- Configure server/browser values in their correct secret classes.
- Verify Stage 1 unified-registry completeness in production, including Stage
  2's two source registrations, without exposing IDs.
- Verify migrations/indexes and worker observability.

Reject progression for missing configuration, broad scope, incomplete
denylist, secret leakage, or failing role tests.

### Phase 1 — Dedicated test identity

- Run all unit/integration tests and trusted live Google CI.
- Exercise OAuth, Picker, snapshot, replace-tab, forced failures, recovery, and
  cleanup against the disposable root.
- Confirm no production owner credentials or production data are used.

Reject progression for orphaned artifacts, flaky checksum/promotion behavior,
or service-account substitution.

### Phase 2 — Production owner connection, no general delivery

- Owner connects the configured production Google account.
- Verify least-privilege scopes and health.
- Create a dedicated Vantage folder/destination.
- Confirm all operational workbooks are denied.
- Generate Stage 3 previews using production-only canonical Mongo, with no
  external write.

Reject progression if identity, preview checksum, capacity, PII disclosure, or
destination ownership is unclear.

### Phase 3 — Canary deliveries

- Temporarily enable delivery for the owner-controlled canary window.
- Run one small snapshot, verify it through Google and Vantage history.
- Run one managed replace-tab, then a second replacement proving staging and
  old-tab behavior.
- Simulate/rehearse worker interruption, transient retry, failed verification,
  and cleanup.
- Review audits, alerts, checksums, and provider quota.

Reject progression for any truncation, mismatch, duplicate delivery, human-tab
risk, PII telemetry, or inability to preserve the prior tab.

### Phase 4 — Owner availability

- Deploy the accepted manual reporting path for owner use; if the optional
  reporting delivery gate was approved, enable it.
- Keep v1 scheduling absent.
- Monitor initial runs and cleanup backlog.
- Obtain owner and operations signoff with the final evidence package.

## 16. Rollback and incident response

Primary rollback uses the normal deployment rollback plus safe cancellation of
queued/not-yet-writing runs. If the optional
`REPORTING_GOOGLE_DELIVERY_ENABLED` proposal was approved and implemented, set
it false first to block new destination mutations and runs while preserving
history and read access.

During rollback:

- allow already promoted, verified deliveries to remain recorded;
- request safe cancellation for queued/querying/writing runs;
- do not interrupt a promotion blindly—inspect/checkpoint and finish recovery;
- preserve the last known-good managed tab;
- quarantine ambiguous artifacts rather than deleting by name;
- retry marked incomplete-artifact cleanup after provider health returns;
- revoke/disconnect OAuth only for credential compromise or owner direction;
- never switch reporting to the operational service account;
- do not modify canonical Mongo data to compensate for a report artifact.

An incident record captures affected run/destination IDs, phase, checksums,
Google IDs, actor, gate action, artifact disposition, and sanitized cause.

## 17. Likely files

Server:

- `src/config/domain/googleDriveOAuth.ts`
- `src/services/googleDriveOAuth/googleDriveOAuth.service.ts`
- `src/services/googleDriveOAuth/spreadsheet.service.ts`
- `src/services/googleDriveOAuth/` Picker/Drive adapters
- `src/models/GoogleDriveConnection.ts`
- `src/models/ReportingDestination.ts`
- `src/models/ReportingDefinition.ts`
- reporting revision model
- `src/models/ReportingRun.ts`
- `src/models/ReportingDelivery.ts`
- `src/services/reporting/` delivery, ownership, verification, promotion,
  cleanup, authorization, and audit Modules
- `src/routes/google-drive-oauth.routes.ts`
- `src/routes/reporting.routes.ts`
- `src/app.ts`
- dedicated reporting queue consumer under `api/queues/`
- reporting worker tests and live Google integration tests
- `scripts/test-create-google-spreadsheet.ts` as proof/fixture input, not the
  production implementation

Shared patterns to reuse:

- `src/services/sheetSync/drainer/runSheetSyncDrain.ts`
- `src/services/sheetSync/drainer/leases.ts`
- `src/models/SheetSyncRun.ts`
- `src/config/domain/sheetSync.ts`
- `src/services/observability/`

Admin:

- `vantage-admin/server/auth/authorization.ts`
- `vantage-admin/server/auth/trustedProxyHeaders.ts`
- `vantage-admin/app/api/proxy/[...path]/route.ts`
- `vantage-admin/lib/api/` reporting/OAuth clients
- owner settings for OAuth and Picker
- destination list/detail/editor components
- reporting definition list/builder/preview components
- run history/detail components
- read-only admin reporting health/history views
- `vantage-admin/components/operations-registry/`
- `vantage-admin/lib/api/operationsRegistry.ts`
- `vantage-admin/components/observational/observational-sheet-sync.tsx` as an
  observational UI reference

Final file placement and naming should follow repository conventions discovered
during implementation; do not create a second competing Google or run
framework.

## 18. Stage handoffs

### 18.1 Required workbook-safety handoff from Stages 1 and 2

Stage 1 supplies:

- the single authoritative server interface returning every registered ingestion
  workbook and operational projection workbook by normalized Google file ID and
  category;
- fail-closed behavior and health signal when registration is incomplete;
- registrations for Master Leads, Master Booked, all configured source Sheet
  Sync targets, and all other operational projection workbooks; and
- shared registry contract tests.

Stage 2 contributes exactly the two required Best Relocation input
registrations and evidence that they remain present while ingestion is disabled.

Accept only if both Stage 2 registrations resolve through the Stage 1 registry,
the unified contract is environment-aware and current at save/run time, and it
does not depend on workbook names or ingestion activation. Reject a Stage
2-specific lookup, static copied list, UI-only validation, masked-ID/title
matching, incomplete configuration, or owner override.

### 18.2 Required handoff from Stage 3

Stage 3 supplies:

- versioned enabled dataset catalog and production-only query executors;
- validated immutable definition/revision and destination snapshot contracts;
- hierarchical registry filter keys plus label snapshots;
- explicit timezone and half-open date semantics;
- PII classifications and export-safe column definitions;
- exact/bounded estimate, capacity inputs, 50-row preview, warnings, intended
  changes, and preview checksum;
- append-only first-delivery approval evidence on the run/audit trail and the
  subsequent fresh-estimate contract, never mutable revision state;
- deterministic canonical row serialization, ordering, pagination cursor,
  worker-owned source-read-through capture contract, and checksum version;
- `ReportingRun` model contract and indexes; Stage 4 owns
  `ReportingDelivery`, its repository, and its indexes;
- passing evidence for reporting acceptance tests 1–9.

Accept only if a worker can resume without changing revision meaning or
persisting full rows, and if preview approval is cryptographically/checksum
tied to the immutable revision draft. Reject mutable run inputs, non-production
database scope, unvetted columns, or silent output limits.

### 18.3 Final handoff to owner and operations

Deliver:

- production configuration checklist with secret/browser-safe classification;
- Cloud API, OAuth consent, scope, origin, and redirect verification;
- role/authorization evidence;
- full acceptance test report, including tests 10–19;
- trusted live Google CI evidence and janitor evidence;
- denylist inventory attestation by category;
- canary snapshot and replace-tab run IDs, checksums, Google artifact links,
  verification, and cleanup results;
- promotion/recovery and no-silent-truncation evidence;
- PII redaction review;
- dashboards, alerts, retention/TTL settings, and runbooks;
- rollback rehearsal evidence, plus deployment-gate evidence only when the
  optional gate is adopted;
- known limitations explicitly stating manual-only, production-only canonical
  Mongo, no historical merge, and no ingestion activation dependency.

Owner acceptance requires successful OAuth/Picker use, safe destination
creation, preview confirmation, one verified snapshot, one verified managed
replace-tab replacement, usable history/artifact links, and understandable
failure remediation.

Operations acceptance requires observable leased runs, retry/checkpoint
recovery, alerts, denylist health, promotion recovery, cleanup/janitor behavior,
rollback rehearsal, and no secret/PII leakage.

Reject final handoff for any unresolved possibility of operational workbook
writes, human-tab takeover, silent truncation, mutable revision execution,
service-account fallback, production OAuth in CI, ambiguous cleanup ownership,
or missing prior-tab preservation.

## 19. Exit criteria

Stage 4 is complete only when:

- the configured owner can connect through OAuth and use Picker under
  `drive.file`;
- browser responses contain no server secret or refresh credential;
- owner can create/select a safe folder and destination;
- the complete denylist is enforced at save, preview, run, and pre-write
  boundaries with no override;
- `replace_tab` modifies only a positively marked Vantage-managed tab;
- snapshots create one verified immutable workbook per run;
- every delivery follows preview and immutable revision rules;
- the durable worker survives duplicate triggers, retries, lease loss, and
  browser disconnect without duplicate delivery;
- writes are bounded, checkpointed, deterministic, fully verified, and never
  silently truncated;
- failed replacement preserves the prior published tab;
- incomplete artifacts are safely cleaned or visibly pending;
- owner-write/admin-read API and UI authorization passes;
- reporting acceptance tests 10–19 and trusted live OAuth/Picker/Google tests
  pass;
- alerts, retention, janitor, dashboards, rollback, and runbooks are accepted;
- owner and operations accept the evidence package;
- reporting still reads only canonical production Mongo data and does not
  authorize historical merge or ingestion activation.

## 20. Source-section traceability

- Sections 1–4: trust-boundary separation, canonical Mongo, preview safety,
  immutable execution, durable work, provenance, no duplicate delivery,
  environment/application responsibility, and delivery sequence.
- Section 21: owner outcome and strict manual-only v1 boundary.
- Section 22: owner OAuth identity, existing Google integration, required
  configuration, Picker keys, server/browser secret split, enabled APIs, and
  `drive.file`.
- Sections 23–25: consumed Stage 3 dataset/filter/production-query/timezone
  contracts and PII-safe vetted columns.
- Section 26: destination/revision/run/delivery records, immutable snapshots,
  checkpoints, verification metadata, and no full-row Mongo copy.
- Section 27: folder/workbook selection, managed-tab ownership, snapshot
  behavior, explicit detach/delete, and complete denylist.
- Section 28: validation, capacity, 50-row preview, intended changes, PII,
  preview checksum, first-run confirmation, fresh estimates, and no silent
  truncation.
- Section 29: queued API, lease, read-through, deterministic pagination,
  bounded writes, checkpoints, retries, verification, promotion, polling, and
  no per-row Sheet Sync jobs.
- Section 30: hidden staging, verified promotion, old-tab preservation, and
  incomplete snapshot cleanup.
- Section 31: owner/admin role split, trusted proxy patterns, and audit.
- Section 32: complete relevant reporting API surface and safe Picker
  bootstrap.
- Section 33: OAuth/Picker settings, destination manager, builder, preview,
  run history/detail, and read-only admin UI.
- Section 34: failure/auth alerts, no routine success, indefinite metadata
  retention, temporary TTLs, and owner-controlled Drive retention.
- Section 35: acceptance tests 10–19 and complete live Google CI requirements.
- Sections 36–38: likely server/admin files and reuse of Sheet Sync,
  observability, OAuth, spreadsheet proof, Registry, proxy, and run UI patterns.
- Section 39: owner can safely create, preview, manually deliver, and verify all
  three vetted production-only datasets without risking input or operational
  sheets; no historical merge is included.
