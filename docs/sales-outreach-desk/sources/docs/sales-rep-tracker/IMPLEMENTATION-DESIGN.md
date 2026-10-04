# Sales rep tracker: implementation design

This document is the engineering contract for building [SPECIFICATION.md](SPECIFICATION.md). The quick checklist and the verified seam discrepancies are in [IMPLEMENTATION-CHECKLIST.md](IMPLEMENTATION-CHECKLIST.md).

Everything here was checked against `feat/sales-rep-tracker` (server `bf460e3c`, admin `692d8ce`) on 30 September 2026. Server paths are relative to `vantage-main-server/`; admin paths are relative to `vantage-admin/`.

"Slice N" refers to spec §11. Slice 1 lands first. Slices 2–6 then build **in parallel** in separate worktrees. Slice 7 follows.

## 0. Rules every slice follows

1. **Domain logic stays on the server.**
   - Permissions, transitions, metrics, money and identity live in `vantage-main-server`.
   - Admin renders server decisions: `allowed_actions`, `blocker_codes`, `status` and labels.
   - Admin never filters an Owner payload to produce a Rep view.
2. **Every write is a command.** Handle each one this way:
   - Read `Idempotency-Key` with `ctx.idempotencyKey(req)`; a missing key is `INVALID_INPUT`.
   - Parse the body with a strict Zod schema.
   - Call `executeCsiCommand({actor, command, idempotency_key, payload: {target_id, body}, operation})` (`src/services/salesIntelligence/transactions.ts:124`).
   - Inside the operation:
     - Recheck the trusted actor, the flag and scope in the same session.
     - Fence the write:
       - existing aggregates use `csiCas(model, id, expected_revision, changes, session)` (`transactions.ts:95`) or `recordForUpdate`;
       - tracking uses `tracking.revision` instead (§3.1).
     - Call `appendCsiAudit` with the kinds from §2.1.
     - Enqueue durable follow-up work with `enqueueCsiJob`.
   - After commit and only when `replayed === false`, call `publishCaptureProjectionWakeup(job_id)` (`src/services/numberActivity/webhookFanout.ts`). That function is the generic post-commit queue wakeup.
3. **Worker writes** (matching, sweeps, projectors and job handlers) do not use `executeCsiCommand`, which admits only Owner and Rep actors. They call `withTransaction` with the context `{session, command_id: new ObjectId(), now, actor: csiWorkerActor(<job id, or a fresh ObjectId hex for a runner>)}`, as `numberActivity/callLogRefresh.ts:328` does.
4. **Map domain duplicate keys.** A duplicate key from a domain unique index inside the operation aborts the transaction and surfaces as a 500 (`transactions.ts:176-184`). Each service catches the error **outside** `executeCsiCommand` and maps it to its `CsiError` by index name.
5. **Response envelopes.**
   - Commands answer `{ok:true, data:{response, replayed}}`. The admin `commandResultSchema` in `lib/api/salesIntelligence.ts` already parses this shape.
   - Reads answer `{ok:true, as_of, data}`. Unknown values are `null` with a `status` or `reason`, never `0`.
   - Every response carries the authoritative state, `revision`, the server `as_of` and `allowed_actions` where relevant.
6. **Authority levels.** Every service takes `scope = csiRepScope(actor)` (`auth.ts:71`).

   | Level | Who passes | Used for |
   |---|---|---|
   | Owner | `guard(req)` | Owner-only routes (`OWNER_REQUIRED` for a Rep) |
   | Read scope (existing E11) | `ctx.inScope(actor, "record", id)`: `responsible_agent_id` **or** any follow-up names the Rep | Reads, notes, Known-job Granot refresh |
   | Strict assignment (new) | `record.responsible_agent_id === scope.agent_id`, rechecked **inside the transaction** | Tracking, starting an attempt, Granot import by URL or Job Number |

   A record read outside scope answers `ctx.notFound` (404). A command outside scope answers `FORBIDDEN` (403). Both are nondisclosing.
7. **Persist the Agent.** `role` and `agent_id` are non-enumerable on the trusted actor and are **not persisted** (`models/salesIntelligence/common.ts:68`). Every new aggregate stores `agent_id` itself, taken from `csiRepScope(actor).agent_id`.
8. **Money.**
   - Integer **minor units** (`*_minor`) plus `currency: "USD"` on every new DTO and in every new stored field.
   - Existing Overview DTOs keep dollars.
   - Convert Booking float dollars with `dollarsToMinor` from §2.3. Never re-split a split allocation.
9. **Time.**
   - Instants are UTC. Business days are `America/New_York` `YYYY-MM-DD`.
   - Windows are `[start, end)` instants built from `easternInstantBounds` (`src/services/dailyOperations/dayDocument.ts:64`). Weeks run Monday–Sunday.
   - Lead `timestamp` is New York wall-clock time stored as UTC. Use `floridaTimestampBounds` for Lead cohorts only.
10. **Pagination.**
   - A keyset cursor is base64url JSON `{k, id}` bound to a digest of the filters and the viewer's Agent. A mismatch is `INVALID_INPUT`.
   - `limit` is at most 50.
   - Sort order is deterministic, with `_id` as the tiebreak.
11. **Never name a body or query field `scope`.** `assertCurrentScope` rejects any value but `"production"`.
12. **Test environment.** Server tests always run with the pinned environment from the checklist; never a bare `pnpm test`. Meaningful server work finishes with `pnpm finish-work --provider codex`, unless `VANTAGE_QUALITY_CHILD=1`.

## 1. Delivery order, worktrees and merge protocol

| Order | Slice | Branch (both repos) | Depends on |
|---|---|---|---|
| 1 | Foundations: kernel plus every shared extension point | `feat/srt-s1-foundation` | none |
| 2 (parallel) | Working tracker | `feat/srt-s2-tracker` | S1 |
| 2 (parallel) | Internal messaging | `feat/srt-s3-inbox` | S1 (end-to-end with S2 facts) |
| 2 (parallel) | Goals and earnings | `feat/srt-s4-goals` | S1 (end-to-end with S2 facts) |
| 2 (parallel) | Granot Case File | `feat/srt-s5-casefile` | S1 |
| 2 (parallel) | Economics and day view | `feat/srt-s6-economics` | S1 |
| 3 | Polish and release | `feat/srt-s7-release` | S2–S6 merged |

**Worktrees.** Create each one with `git worktree add ../<repo>-srt-sN feat/srt-sN` in **both** repos, then run `pnpm install` inside it. Do not junction or share `node_modules`: that is a known trap in this workspace.

**Merging.** Each slice merges into `feat/sales-rep-tracker` by pull request after its own checks pass. Rebase on the integration branch before merging. By construction, the only overlapping files are the delimited shared blocks in §10.

**Contracts between slices** go only through the S1 kernel:
- contribution facts and the evaluator;
- the notification writer;
- the area contributor stubs;
- the `siKeys` and topic map.

A slice never imports another slice's service module.

## 2. Slice 1: foundations

### 2.1 Server registrations (S1 edits these once; later slices do not touch them)

**`src/config/domain/salesIntelligence.ts`**
- `CSI_FLAGS` (l.131): add `TRACKER`, `INBOX`, `GOALS`, `COMPENSATION`, `CASE_FILE_VIEW`, `GRANOT_ACQUISITION` and `ASSIGNMENT_COST`. All default off.
- `CSI_JOB_STAGES` (l.71): add `sales_progress_evaluate`, `sales_attempt_match` and `granot_case_file_refresh`.
- `CSI_ERROR_CODES` (l.95): add the codes below.

| New error code | HTTP status (add to the moved `CSI_STATUS_BY_CODE`) |
|---|---|
| `ATTEMPT_ALREADY_ACTIVE` | 409 |
| `SETUP_REQUIRED` | 409 |
| `POLICY_OVERLAP` | 409 |
| `LOCATOR_UNSUPPORTED` | 422 |
| `LOCATOR_HAS_NO_STABLE_JOB` | 422 |
| `GRANOT_ACQUISITION_UNAVAILABLE` | 503 |

**Audit `kind` enum.** Change both `transactions.ts:201-212` and `models/salesIntelligence/infrastructure.ts:131-144`. Add `attempt`, `note`, `thread`, `instruction`, `notification`, `goal`, `credit`, `compensation`, `case_file` and `transfer`. A tracking change uses the existing `outreach` kind.

**Route context.** Create `src/routes/sales-intelligence-route-context.ts` and move into it, unchanged:
- `guard`, `readerGuard`, `inScope`, `fail`, `notFound` and `STATUS_BY_CODE` (exported as `CSI_STATUS_BY_CODE`) from `routes/sales-intelligence-admin.routes.ts:140-225`;
- a new `idempotencyKey(req)`.

It exports:

```ts
export type CsiRouteContext = { prefix: typeof CSI_ADMIN_PREFIX; connect: typeof connectMongo; flag: typeof csiFlag;
  guard(req: Request): CsiActor; readerGuard(req: Request): CsiActor; inScope(a: CsiActor, kind: keyof RepScopeChecks, id: string): Promise<boolean>;
  fail(req: Request, res: Response, e: unknown): Response; notFound(req: Request, res: Response, resource?: string): Response; idempotencyKey(req: Request): string };
export function createCsiRouteContext(deps: Pick<SalesIntelligenceAdminRouteDeps, "connect"|"flag"|"owner"|"reader"|"repScope">): CsiRouteContext;
```

**Area route registrars.** Create five files, each exporting:

```ts
export type <Area>RouteDeps = {}; // S1 empty; the owning slice adds optional service overrides
export const <AREA>_REP_READ_ROUTES: readonly string[] = [];
export const <AREA>_REP_COMMAND_ROUTES: readonly string[] = [];
export function register<Area>Routes(router: Router, ctx: CsiRouteContext, deps: <Area>RouteDeps = {}): void {}
```

| File | Owning slice |
|---|---|
| `src/routes/sales-intelligence-tracker.routes.ts` | S2 |
| `src/routes/sales-intelligence-inbox.routes.ts` | S3 |
| `src/routes/sales-intelligence-goals.routes.ts` | S4 |
| `src/routes/sales-intelligence-case-file.routes.ts` | S5 |
| `src/routes/sales-intelligence-economics.routes.ts` | S6 |

Registrars add routes **directly on the admin router**, as `router.get(\`${ctx.prefix}/…\`)`. They never use `router.use(subRouter)`, because the access-matrix test's `routesOf` walks only top-level route layers (`sales-intelligence-rep-access.test.ts:84`).

**`routes/sales-intelligence-admin.routes.ts`**:
- `SalesIntelligenceAdminRouteDeps` gains `tracker?`, `inbox?`, `goals?`, `caseFile?` and `economics?`.
- The router builds `ctx` once and calls the five `register*Routes` immediately before `return router`, in the order above.
- `CSI_REP_READ_ROUTES` and `CSI_REP_COMMAND_ROUTES` become `readonly string[]`: the existing literals followed by the five area spreads.

**`src/routes/sales-intelligence-rep-access.test.ts`**: `env()` sets all seven new flags to `"true"`. No other change: new routes are then checked automatically.

**Registrar obligations** (enforced by that test):
- The Owner must be "reached": a guard pass that is not a 401/403/404.
- A Rep is reached only on the listed routes.
- Every other route uses `ctx.guard`.
- Call `ctx.connect()` before any branch that could answer 404 for the Owner.
- An empty body `{}` must produce a 400 or reach `connect`.

**Models.** Create one file per area in `src/models/salesIntelligence/`: `contributions.ts` and `notifications.ts` (S1), `tracker.ts` (S2), `inbox.ts` (S3), `goals.ts` (S4), `caseFile.ts` (S5) and `economics.ts` (S6).
- Each exports `<AREA>_MODEL_REGISTRY = [{name, model, indexes}, …] as const`. The S2–S6 stubs are `[] as const`.
- The existing `as const` `CSI_MODEL_REGISTRY` in `registry.ts` spreads all seven arrays after its existing entries. Do not introduce an `any`-typed entry type: lint runs with `--max-warnings 0`.
- `foundation.test.ts:228` then checks isolated routing and `autoIndex === false` for every new model automatically.

**Area manifests.** Create `src/services/salesIntelligence/{tracker,inbox,goals,caseFileView,economics}/manifest.ts`. Each exports:
- `<AREA>_STAGE_HANDLERS: Partial<Record<CsiStage, StageHandler>>`;
- `<AREA>_RECOVERY: Array<{name: string; flag: CsiFlag; run: () => Promise<unknown>}>`.

Handlers load their worker **lazily**, as `(id) => import("./worker").then(m => m.run…(id))`, to avoid import cycles.

`src/services/salesIntelligence/salesAreas.ts` concatenates the manifests and the S1 kernel's own entries.

Wire them in with one line each:
- `defaultStageHandlers` (`src/services/numberActivity/jobDispatch.ts:46`) ends with `...SALES_AREA_STAGE_HANDLERS`.
- The default `extraRecovery` list (`src/routes/sales-intelligence-cron.routes.ts:151`) ends with `...SALES_AREA_RECOVERY`.
- **Do not add `vercel.json` crons.** All periodic work runs in the one-minute job-recovery cron.
- Each recovery entry takes its own `MongoLeaseStore(getSalesIntelligenceSyncStateModel())` lease (scope `sales-tracker:<name>`), stops after 20 s and processes at most 200 items per run.

**Rep scope.** `src/services/salesIntelligence/repScope.ts` adds `recordAssignedToRep(recordId, agentId, session?)`. It is not added to `RepScopeChecks`: strict checks run in transactions, never at route level.

**Policy fields.** `src/validation/v1/salesIntelligence.ts` gets two **optional** CSI policy fields:
- `attempt_stale_minutes` (int 60–1440);
- `attempt_match_tolerance_seconds` (int 0–900).

They are writable only while `TRACKER` is on, following `assertEvolutionPolicyWritable` (`policy.ts:60`). Otherwise an older build's strict schema would reject a stored policy after a rollback. Readers use `policy.attempt_stale_minutes ?? 240` and `?? 120`.

**`/attention/capabilities`** (`routes/sales-intelligence-admin.routes.ts:375`) adds:
- `data.features = {tracker, inbox, goals, compensation, case_file_view, granot_acquisition, assignment_cost}` from the flags;
- `data.capabilities.work_mode = csiFlag("TRACKER")`.

**Live** (`src/services/salesIntelligence/live.ts`): see §9 for the full map.
- Rep streams watch only the collections whose topics are Rep-visible: `watchCsiChanges(collections)` gets a collection argument.
- Add `{$project: {ns: 1}}` to the watch pipeline.
- `live.test.ts` covers both.

### 2.2 Kernel models (S1-owned)

**`sales_contribution_facts`** (`SalesContributionFact`, `models/salesIntelligence/contributions.ts`). This is the only integration bus between tracker, inbox and goals.

| Field | Type / rule |
|---|---|
| `fact_key` | `attempt:<attemptId>` \| `call:<interactionId>` \| `deal:<bookingId>:<agentId>` \| `granot_refresh:<refreshId>` |
| `kind` | `attempt \| provider_call \| deal_credit \| granot_refresh` |
| `agent_id` | ObjectId, required |
| `occurred_at` | `attempt`: its end · `provider_call`: `ended_at ?? started_at` · `deal_credit`: Booking `createdAt` · `granot_refresh`: its publication time |
| `business_day` | New York `YYYY-MM-DD` of `occurred_at` |
| `lead_ref` | `{model, id}` or null. Number-only work has none. |
| `outreach_id`, `contact_number_id`, `booking_id`, `linked_call_id` | ObjectId or null |
| `outcome` | `answered \| rejected \| no_answer \| busy \| failed \| abandoned \| unknown` or null |
| `qualifying` | Boolean: the outcome is in `QUALIFYING_OUTCOMES`, or the fact is a provider call with outcome `unknown` |
| `verification` | `rep_reported \| provider_verified` |
| `merged_into` | The `fact_key` of the surviving fact, or null. Only rows with null are counted. |
| `has_summary`, `summary_at` | For `add_summary` instructions |
| `amount_minor`, `currency`, `split_count` | For deal credit |
| `state` | `active \| reversed` |
| `source_fingerprint` | SHA-256 over the semantic inputs; an unchanged fingerprint means no write |
| `rule_version` | `"sales-contribution-v1"` |
| `revision` | Standard |
| `dataset` | `{deployment, database}`, from `csiDataset()` |

- Indexes:
  - unique `sales_fact_key_unique {fact_key:1}`;
  - `sales_fact_agent_kind_time {agent_id:1, kind:1, occurred_at:1}`;
  - `sales_fact_outreach_time {outreach_id:1, occurred_at:-1}`;
  - `sales_fact_linked_call {linked_call_id:1}`.
- Retention: none. Every fact is rebuildable from its sources.

**`sales_notifications`** (`models/salesIntelligence/notifications.ts`).

| Field | Type / rule |
|---|---|
| `recipient_key` | `owner` (role inbox) or `agent:<agentId>` |
| `seq` | Per-recipient integer from `sales_notification_counters`, allocated by `$inc` in the same transaction. Sequence order therefore equals commit order. |
| `event_key` | Stable per event (§2.4) |
| `kind` | See §2.4 |
| `subject` | `{outreach_id, instruction_id, thread_id, goal_id, attempt_id, refresh_id}`, each an ObjectId or null |
| `title` | ≤ 140 characters, safe text, no phone numbers |
| `body` | ≤ 500 characters or null |
| `deep_link` | Must start with `/sales-intelligence` |
| `action_state` | `none \| open \| resolved` |
| `resolved_at`, `revision` | Standard |

- Indexes:
  - unique `sales_notification_identity_unique {recipient_key:1, event_key:1, kind:1}` (spec §6);
  - unique `sales_notification_seq_unique {recipient_key:1, seq:1}`;
  - `sales_notification_action {recipient_key:1, action_state:1, seq:-1}`;
  - TTL `sales_notification_ttl {createdAt:1}`, 365 days.

**Companion collections.**
- **`sales_notification_counters`**: `{recipient_key, seq}`, unique on `recipient_key`.
- **`sales_notification_read_states`**: `{reader_key, recipient_key, watermark_seq, read_ids[], revision}`, unique on `reader_key`.
  - `reader_key` is `owner:<adminUserId>` (per Owner user) or `agent:<agentId>`.
  - `read_ids` is capped at 500 and holds only ids with `seq > watermark_seq`.

### 2.3 Kernel services (`src/services/salesIntelligence/contributions/`, `notifications/`)

```ts
// contributions/windows.ts
export type SalesWindow = { start: Date; end: Date; period_kind: "day"|"week"|"month"|"custom"; time_zone: "America/New_York" };
export function salesWindowFor(kind: "day"|"week"|"month", anchorDay: string): SalesWindow;      // week = Monday 00:00 .. next Monday 00:00 NY
export function customSalesWindow(fromDay: string, throughDay: string): SalesWindow;            // throughDay inclusive; ≤ 92 days
export function inSalesWindow(at: Date, w: SalesWindow): boolean;                                // start <= at < end
// contributions/money.ts
export function dollarsToMinor(amount: number): number;                 // Math.round(amount * 100); throws on NaN/Infinity
export function percentOfMinor(minor: number, bps: number): number;     // half away from zero: sign(m)·floor((|m|·bps + 5000) / 10000)
// contributions/metrics.ts
export const CONTRIBUTION_RULE_VERSION = "sales-contribution-v1";
export const SALES_METRICS = ["attempts","distinct_leads_attempted","distinct_leads_contacted","official_deals","booked_binder_credit"] as const;
export const QUALIFYING_OUTCOMES = ["answered","rejected","no_answer","busy"] as const;   // failed / abandoned never count
export const CONTACTED_OUTCOMES = ["answered","rejected"] as const;
export type EvidencePolicy = "any" | "provider_verified";
export type ProgressRule = { metric: (typeof SALES_METRICS)[number]; target: number; window: SalesWindow; evidence: EvidencePolicy;
  agent_id: string; since?: Date | null; lead_key?: string | null; outreach_id?: string | null };
export function evaluateProgress(rule: ProgressRule, facts: readonly FactRow[]): { progress: number; remaining: number; overachieved: boolean;
  contributor_count: number; contributors: Array<{ fact_key: string; occurred_at: string; lead_key: string | null; verification: string }> /* ≤ 200 */ };
export async function loadFactsFor(agentId: string, window: SalesWindow, kinds: readonly FactKind[], session?: ClientSession): Promise<FactRow[]>; // ≤ 5000, indexed
// contributions/facts.ts — CAS on (fact_key, revision); insert when missing; no-op when source_fingerprint is unchanged
export async function upsertContributionFact(ctx: CsiTransactionContext, fact: FactInput): Promise<{ fact_key: string; revision: number; changed: boolean }>;
//   when changed: enqueueCsiJob({stage:"sales_progress_evaluate", subject_key:`agent:${id}`, input_revision: revision,
//     input_refs:[factId], dedupe_key:`csi:progress:${agent}:${fact_key}:${revision}`}) and return the job id for the post-commit wakeup
// contributions/progressJob.ts — the stage handler: claim, then evaluateInstructionsForAgent (inbox/progressHook.ts)
//   and evaluateGoalsForAgent (goals/progressHook.ts); S1 ships both hooks as no-op stubs
// notifications/record.ts
export async function recordSalesNotification(ctx: CsiTransactionContext, n: NotificationInput): Promise<{ id: string; seq: number; created: boolean }>;
export async function resolveSalesNotifications(ctx: CsiTransactionContext, where: { kind: SalesNotificationKind; subject: Partial<Subject> }): Promise<number>;
// src/services/salesIntelligence/jobDrain.ts — the generic claim/run/complete loop over one stage, deadline-bounded
export async function drainCsiStage(stage: CsiStage, run: (jobId: string) => Promise<unknown>, opts: { max: number; deadlineMs: number }): Promise<{ claimed: number; ok: number; failed: number }>;
```

**Evaluator semantics.** Every metric starts from the same base filter. A fact counts only if:
- `agent_id` matches;
- `state` is `active`;
- `merged_into` is null;
- `occurred_at` falls in `[max(window.start, since), window.end)`.

Then per metric:

| Metric | Counts |
|---|---|
| `attempts` | Qualifying facts of kind `attempt` or `provider_call` |
| `distinct_leads_attempted` | Qualifying facts that have a `lead_ref`, counted as unique `Model:id` |
| `distinct_leads_contacted` | As above, restricted to `CONTACTED_OUTCOMES` |
| `official_deals` | `deal_credit` facts with `amount_minor > 0` |
| `booked_binder_credit` | Sum of `amount_minor` over `deal_credit` facts |

- `evidence: "provider_verified"` keeps only `verification === "provider_verified"`.
- `remaining = max(target − progress, 0)`.

### 2.4 Notification kinds and event keys (S1 enum; producers named)

| Kind | Recipient | `event_key` | Producer | Actionable |
|---|---|---|---|---|
| `assignment` | new Agent | `assignment:<auditEventId>` | S6 transfer projector | no |
| `instruction_actionable` | Agent | `instruction:<id>:issued` | S3 create | yes, resolved on fulfil, cancel or expire |
| `message` | other party | `message:<messageId>` | S3 | no |
| `instruction_help_requested` | owner | `instruction:<id>:help:<messageId>` | S3 reply with `needs_help` | yes, resolved on the next Owner reply or cancel |
| `instruction_fulfilled` | owner | `instruction:<id>:fulfilled` | S3 progress hook or complete | no |
| `instruction_expired` / `instruction_cancelled` | Agent (and owner for expired) | `instruction:<id>:expired` / `:cancelled` | S3 | no |
| `attempt_needs_resolution` | Agent | `attempt:<id>:stale` | S2 stale sweep | yes, resolved on resolve |
| `granot_refresh_failed` | requesting Agent or owner | `granot_refresh:<id>:failed` | S5 worker | no |
| `granot_identity_review` | owner | `granot_refresh:<id>:identity` | S5 worker | yes |
| `goal_achieved` / `goal_adjusted` | goal Agent (and owner for Owner targets) | `goal:<id>:achievement:<achievementId>` | S4 | no |

Active-call ticks never create notifications (spec §6).

### 2.5 Area contributor stubs (S1 creates; the owning slice fills them)

Each of these files exports functions returning empty `Map`s:
- `src/services/salesIntelligence/inbox/contributors.ts` (S3)
- `goals/contributors.ts` (S4)
- `caseFileView/contributors.ts` (S5)
- `economics/contributors.ts` (S6)

The functions are:

```ts
export async function overlayFields(outreachIds: string[], scope: {agent_id: string} | null, now: Date): Promise<Map<string, Partial<TrackerOverlay>>>;
export async function repRowFields(agentIds: string[], scope: {agent_id: string} | null, now: Date): Promise<Map<string, Partial<TrackerRepRow>>>;
```

The DTO types live in `src/services/salesIntelligence/contributions/contracts.ts` (S1). Each area owns specific fields and returns only those:

```ts
export type TrackerOverlay = { outreach_id: string;
  tracking: { mode: "outreach"|"tracked"; effective: boolean; revision: number; changed_at: string|null };           // S2
  attempt: { active: AttemptSummary|null; last: AttemptSummary|null };                                                 // S2
  allowed_actions: Array<{ action: "track"|"return"|"start_attempt"|"add_note"|"granot_refresh"|"granot_import"; allowed: boolean; blocker_codes: string[] }>; // S2 (+S5 granot_*)
  instructions: { unread: number; open: number } | null;                                                               // S3
  granot: { availability: "ready"|"partial"|"not_retrieved"|"unavailable"; verified_at: string|null; freshness: "fresh"|"stale"|"unknown"; conflict_count: number } | null; // S5
  opportunity: { amount_minor: number|null; currency: "USD"|null; source: "granot_job_page"|"granot_report"|null; observed_at: string|null; status: "known"|"unknown" } | null }; // S6
export type TrackerRepRow = { agent_id: string; name: string;
  active_attempt: AttemptSummary|null; provider_live_calls: Array<{ interaction_id: string; outreach_id: string|null; started_at: string }>;
  call_state: { reported: boolean; verified: boolean; owner_call_progress: boolean; disagreement: "none"|"reported_only"|"provider_only" };  // S2
  today: { attempts_completed: number; answered: number; rejected: number; no_answer: number; busy: number; failed: number; abandoned: number;
           distinct_leads_attempted: number; provider_verified_calls: number|null; coverage: "complete"|"partial"|"missing" };         // S2
  workload: { open_outreach: number; tracked: number }; new_leads_today: number;                                                         // S2
  instructions: { open: number; overdue: number } | null;                                                                               // S3
  goals: { active: number; achieved_today: number; headline: { goal_id: string; metric: string; progress: number; target: number } | null } | null; // S4
  cost: { assigned_cost_minor: number; unpriced_leads: number; currency: "USD" } | null };                                              // S6, Owner only
```

### 2.6 Ops, replica harness and docs (S1)

**`ops/sales-rep-tracker-indexes.ts`**
- Default `--report` lists the missing indexes for every registry entry whose collection is in the allowlist:
  - new collections: `sales_*` and `granot_job_*` / `granot_case_file_*`;
  - named extras: `outreach_records.outreach_tracking`, `booked_leads.sales_credit_booked_updated` and `cancelled_leads.sales_credit_cancelled_updated`.
- `--apply --confirm-production=<db>` creates them.
- It is guarded by `assertProductionWriterMatchesDeployment` (`ops/lib/production-writer-guard.ts:102`). The pure plan function lives in `ops/lib/sales-rep-tracker-indexes.ts`, with a test beside it.

**Replica harness.** `ops/sales-rep-tracker.replica.ts` is a copy of `ops/full-backfill.replica.ts` with:
- database `testvantagemovers_salestracker`;
- the command `node --import tsx --import ./ops/test-setup.ts --test --test-concurrency=1 "ops/replica/sales-rep-tracker/*.replica.test.ts"`.

Each slice adds **its own** `ops/replica/sales-rep-tracker/<area>.replica.test.ts`. Every file drops the database, builds indexes from `CSI_MODEL_REGISTRY` and forbids `fetch`. S1 adds the package script `"test:sales-tracker:replica": "node --import tsx ops/sales-rep-tracker.replica.ts"`; the quality worker is not allowed to edit `package.json`.

**Docs** (S1 creates them all as `status: draft`, so later slices edit only their own):
- the Service doc stubs and catalog rows (§13);
- the `CONTEXT.md` glossary block;
- the new flags section in `docs/knowledge/environment.md`.

### 2.7 Admin extension points (S1)

- **`server/auth/authorization.ts`.** `REP_PROXY_ROUTES` becomes `[...CORE, ...TRACKER_REP_PROXY_ROUTES, …]`, spread from `server/auth/rep-routes/{tracker,inbox,goals,case-file,economics}.ts`. Those files start empty; each slice fills its own and adds `server/auth/rep-routes/<area>.test.ts`.
- **`lib/query/salesIntelligence.ts`.** The full topic map from §9 lands in S1.
- **`components/sales-intelligence/data/query-keys.ts`.** Every builder from §9.2 lands in S1, with a `SAMPLES` entry in `tests/sales-intelligence/live-topics.test.ts`. The hand-built `overview-team/activity/outcomes` keys (`data/use-team-overview.ts:6-8`, `desk/metrics-strip.tsx:89`, `rep/my-workload.tsx:35`, `rep-view/rep-view.tsx:57`) move onto `siKeys` (fixes D4).
- **`components/sales-intelligence/data/use-sales-features.ts`.** `useSalesFeatures()` reads `features` from `/attention/capabilities`. `attentionCapabilitiesSchema` is already `.passthrough()`; add an optional `features` field.
- **Slots.** One `slots.tsx` per area folder (`tracker/`, `inbox/`, `goals/`, `case-file/`, `economics/`). Each exports the named components below, each returning `null`. S1 mounts them once, and the owning slice replaces their bodies.

| Slot | Mounted in | Props |
|---|---|---|
| `TrackerWorkSlot`, `NotesSlot` (S2) | `outreach/work-rail.tsx` `WorkRailLoaded`: above and below `<WorkTab/>` | `{outreachId}` |
| `InstructionsSlot` (S3) | `work-rail.tsx`, under `TrackerWorkSlot` | `{outreachId}` |
| `GranotRefreshSlot` (S5) | `work-rail.tsx`, last | `{outreachId}` |
| `GranotCaseFileSlot` (S5) | `outreach/case-file-tab.tsx` `CaseFileBody`, after `#move-details` | `{outreachId}` |
| `WorkModeSlot` (S2) | `desk/desk.tsx` toolbar (`:290-296`) and `rep-view/rep-view.tsx` `RepViewHeader` | `{agentId?}` |
| `TrackerCardSlot` (S2) | `card/outreach-card.tsx` | `{outreachId}` |
| `ActiveAttemptBannerSlot` (S2) | `rep/rep-frame.tsx` and `desk/page-header.tsx` | none |
| `InboxButtonSlot` (S3) | `rep/rep-frame.tsx` and `desk/page-header.tsx` | none |
| `InstructionComposerSlot` (S3) | `rep-view/rep-view.tsx` `RepViewHeader` | `{agentId}` |
| `DayStripSlot`, `AssignmentCostSlot` (S6) | `overview/phase-c-overview.tsx`: top (Owner); beside `CostDetail` | none |
| `LiveRepRowsSlot` (S2) | `phase-c-overview.tsx`, under `DayStripSlot` | none |
| `GoalsSlot` (S4) | `phase-c-overview.tsx`, after `ActivityBlock` | none |

  Every slot returns `null` unless `useSalesFeatures()` has its flag on. That makes the admin safe to deploy before the server flags are turned on.

  **Cross-area UI goes only through slots.** Example: S2's expanded Owner Rep row shows notes, attempts, instructions, Granot sections and potential value. It renders `InstructionsSlot`, `GranotCaseFileSlot` and its own components; it never imports another area's internal components or hooks.

- **Copy.** Each area keeps its strings in `components/sales-intelligence/<area>/copy.ts`. S1 wires them into `sales-intelligence-copy.ts` as `copy.tracker`, `copy.inbox`, `copy.goals`, `copy.caseFile` and `copy.economics`.
- **CSS.** `styles/sales-intelligence.css` gets six empty delimited blocks at the end, in this order, one blank line apart:

  ```css
  /* UI-3: MOTION start */
  /* UI-3: MOTION end */

  /* UI-3: TRACKER start */
  /* UI-3: TRACKER end */

  /* UI-3: INBOX start */
  /* UI-3: INBOX end */

  /* UI-3: GOALS start */
  /* UI-3: GOALS end */

  /* UI-3: CASEFILE start */
  /* UI-3: CASEFILE end */

  /* UI-3: ECONOMICS start */
  /* UI-3: ECONOMICS end */
  ```

  A slice writes only inside its own block. Colors must be `var(--si-*)` tokens (`rep-phone.test.ts:118`). A new token also goes into the gallery `TOKEN_GROUPS` (`gallery.test.ts:48`); only S7 adds tokens.
- **Gallery.** `app/(dashboard)/sales-intelligence/dev/gallery/sections/{tracker,inbox,goals,case-file,economics}.tsx` start as empty sections and are registered once.
- **Motion kit** (`components/sales-intelligence/motion/`, S1):
  - `use-reduced-motion.ts`: `matchMedia` in an effect, SSR-safe.
  - `achievement-memory.ts`:
    - `seenAchievement(id)` and `markAchievementsSeen(ids)` use `localStorage` key `si.achievements.seen.v1`, with at most 500 ids, and every access wrapped in try/catch.
    - The first render marks all ids already present as seen **without** animating.
    - An id not seen before animates only after the change frame that brought it in.
  - `live-announcer.tsx`: one polite `aria-live` region per page.
  - `motion.ts`: class helpers for `si-motion-track-out`, `si-motion-return` and `si-motion-achieve`. The keyframes go in the MOTION CSS block, each with a `prefers-reduced-motion: reduce` fallback that changes only opacity or outline.

## 3. Slice 2: working tracker

### 3.1 Tracking (on the existing Outreach record)

**Schema** (`src/models/salesIntelligence/outreach.ts`). Add a `tracking` subdocument, `_id:false`, `strict:"throw"`, **with no default**:

```ts
tracking: {mode: enumeration(["outreach","tracked"]), agent_id: oid, changed_at: at,
  changed_by: {type: actor, required: true}, revision}
```

Add the index `outreach_tracking {"tracking.agent_id":1, "tracking.mode":1, state:1}`. It is not unique, so it does not need an index fence.

**Effective membership** is `tracking?.mode === "tracked" && String(tracking.agent_id) === String(responsible_agent_id) && state !== "closed"`. Consequences:
- An absent field means outreach mode, so no backfill writes are needed.
- Reassignment needs **no** write and drops membership; the history stays in the audit.
- `Closed` still shows the tracking history.

**`POST /outreach/:id/tracking`** takes `{mode: "tracked"|"outreach", expected_tracking_revision: int ≥ 0}`, where `0` means absent.
- **Rep:** strict assignment, and the record must not be closed.
- **Owner:** any record with `responsible_agent_id`. An unassigned record gives `ILLEGAL_TRANSITION` ("assign first").
- **Write:** `updateOne({_id, …revision filter}, {$set: {tracking: {..., agent_id: responsible_agent_id, revision: expected+1}}}, {session})`. A result of 0 modified is `REVISION_CONFLICT`.
- This write does **not** bump the record `revision`: workers bump that revision every minute, and fencing on it would make Track flaky. It also leaves `last_activity_at`, owner instructions and jobs alone.
- **Audit:** kind `outreach`, event `tracking_set`, with `{prior_mode, mode, agent_id}`.
- **Response:** `{outreach_id, tracking, as_of}`. Undo sends the inverse mode with the returned revision.

### 3.2 My Tracker mode on the list

`attentionQuerySchema` (`src/services/salesIntelligence/outreach/attention.ts:135`) gains `work_mode: z.enum(["all","outreach","tracked"]).optional()`. Absent means today's digest and behaviour.

When the parameter is present and not `all`, `readAttention` does the following:
1. It loads the live tracked set: one indexed query on `outreach_records`. For a Rep it filters `tracking.agent_id = agent`; for the Owner it filters the `agent_id` filter or everything, capped at 5,000.
2. It computes `subjectKey(record.subject)` for each record and keeps only the effective members.
3. It filters the index entries by `entry.subject_key` **before** counting and pagination, so totals and drills agree.

The cursor digest includes `work_mode` and a SHA-256 of the sorted tracked subject keys. When the set changes between pages, `readAttention` throws `ATTENTION_SNAPSHOT_EXPIRED` (409). The new desk list then restarts from page 1 (S2 adds that handling in `data/use-attention.ts`, where today only `_legacy` handles it).

Rows missing from the snapshot, because they were published less than 3 minutes ago, appear at the next publish. The card overlay (§3.6) is live.

### 3.3 Sales attempts

**`sales_attempts`** (`SalesAttempt`, `models/salesIntelligence/tracker.ts`).

| Field | Type / rule |
|---|---|
| `dataset` | `{deployment, database}` |
| `outreach_id` | ObjectId, required |
| `subject` | Copy of the record's subject |
| `lead_ref` | Leads only |
| `contact_number_id` | `record.primary_contact_number_id` at start, or `subject.contact_number_id` |
| `agent_id` | Required |
| `started_by` | `actor` subschema |
| `started_at`, `stale_after` | `stale_after = started_at + policy.attempt_stale_minutes` |
| `ended_at` | Date |
| `state` | `in_progress \| completed \| needs_resolution` |
| `outcome` | `answered \| rejected \| no_answer \| busy \| failed \| abandoned`, or null |
| `summary` | `{text ≤ 2000, revision, updated_at, updated_by}` or null |
| `resolution` | `{by_role, by_id, at, reason, late: boolean}` or null |
| `evidence` | `{source: rep_reported \| provider_verified, call_interaction_id, match: {status: pending \| linked \| ambiguous \| unmatched \| not_applicable, reason, candidate_count, evaluated_at, call_projection_revision, rep_fingerprint}}` |
| `history` | ≤ 50 entries of `{at, by_role, by_id, field, prior, next, reason}` |
| `revision` | Standard |

- Unique indexes (fences):
  - `sales_attempt_active_agent_unique {agent_id:1}`, partial `{state:"in_progress"}`: one active attempt per Rep;
  - `sales_attempt_call_unique {"evidence.call_interaction_id":1}`, partial `{"evidence.call_interaction_id": {$type: "objectId"}}`: one interaction is linked to at most one attempt.
- Other indexes:
  - `sales_attempt_outreach {outreach_id:1, started_at:-1}`;
  - `sales_attempt_agent {agent_id:1, started_at:-1}`;
  - `sales_attempt_stale {state:1, stale_after:1}`;
  - `sales_attempt_number {contact_number_id:1, started_at:1}`.
- Retention: none (business evidence).

**State machine** (server time only):

```
(start) ──▶ in_progress ──finish(outcome)──▶ completed
                 │   (now ≥ stale_after: read-time display + minute sweep)
                 └────────────▶ needs_resolution ──resolve(outcome, reason)──▶ completed (resolution.late = true)
completed ──correct_outcome(outcome, reason)──▶ completed (fact revised, history appended)
```

- **Read-time state.** `displayAttemptState(a, now)` returns `needs_resolution` for an `in_progress` attempt with `now ≥ stale_after`, so a Rep is never "on a call" forever even before the sweep runs.
- **Sweep.** `tracker/staleSweep.ts` `runAttemptStaleSweepOnce({now, limit: 200})` (recovery `tracker_attempt_stale`, flag `TRACKER`):
  - moves the attempt to `needs_resolution` by CAS;
  - audits the change;
  - sends `attempt_needs_resolution`.
  - It creates **no** fact.
- **`finish` after `stale_after`** is `ILLEGAL_TRANSITION`; the UI offers Resolve.

**Commands**

| Route | Body (strict) | Who | Effects |
|---|---|---|---|
| `POST /outreach/:id/attempts` | `{}` | Rep (strict assignment) | 1) Guards via `tracker/guards.ts` `salesExecutionBlocker(record, ctx)`, the same predicates as `applyOwnerCommandInTransaction` at `followups/commands.ts:72-91,162-165`: exact Booking or authoritative closure, a closed record, `CRM_DISPOSITION_CLOSED`, `DISPOSITION_REVIEW`, or an active `call` restriction on the primary Number (`CONTACT_RESTRICTED`). An official closure answers `{blocked: "official_closure"}` and writes nothing; `outreach_ensure` applies the closure. 2) An existing active attempt that is stale is moved to `needs_resolution` in the same transaction; a fresh one is `ATTEMPT_ALREADY_ACTIVE`, and the client then reads `GET /attempts/active`. 3) Insert and audit (`attempt_started`). A duplicate key on `sales_attempt_active_agent_unique` from a two-tab race also maps to `ATTEMPT_ALREADY_ACTIVE`. |
| `POST /attempts/:id/commands` `finish` | `{command, expected_revision, outcome, summary?}` | Author | CAS; `ended_at = now`; upsert fact `attempt:<id>`; enqueue `sales_attempt_match` (dedupe `csi:attempt-match:<id>:<rev>`) when there is a Number; audit `attempt_finished` |
| `… set_summary` | `{command, expected_revision, text}` | Author | Summary revision +1; fact `has_summary` only (**no** new fact or progress unit); audit |
| `… correct_outcome` | `{command, expected_revision, outcome, reason}` | Author within 24 h of `ended_at`, or the Owner | Fact revised, which triggers progress re-evaluation and may produce a goal adjustment; history entry |
| `… resolve` | `{command, expected_revision, outcome, reason}` | Author, or the Owner on any `in_progress`/`needs_resolution` attempt (stranded work) | As `finish`, with `resolution` set; resolves the `attempt_needs_resolution` notification |

- **Authority.** Attempt commands authorize on `attempt.agent_id === scope.agent_id`, **not** on current record assignment. A reassigned Rep can finish its own attempt but cannot start a new one (spec acceptance 14).
- **Owner.** The Owner never starts attempts and keeps using `call_progress`.
- **Clocks.** Attempts never touch the Outreach record, so they never reset `last_activity_at`.

**Reads**

| Route | Scope | Returns |
|---|---|---|
| `GET /outreach/:id/attempts?cursor` | Record read scope | Attempts, newest first |
| `GET /attempts/active` | Rep: its own active attempt · Owner: all active attempts (≤ 50) | Active attempts |

The DTO is `AttemptSummary`: `{id, outreach_id, agent_id, state, display_state, outcome, started_at, ended_at, stale_after, summary, evidence: {source, call_interaction_id, match_status, match_reason}, revision, allowed_commands}`.

### 3.4 Provider-call matching (`tracker/match.ts`, pure)

```ts
export function matchAttempt(attempt: AttemptRow, calls: CallRow[], links: RepIdentityLinkRow[], peers: AttemptRow[],
  tolerance_s: number): { status: "linked"; call_id: string } | { status: "ambiguous"|"unmatched"|"pending"; reason: string; candidate_count: number };
```

The steps run in order:
1. **Number.** Without `attempt.contact_number_id`, the status is `not_applicable`.
2. **Candidates.**
   - The query uses the existing index `call_interaction_number_started_id`: `contact_number_id` equal, `merged_into_id: null`, `purged_at: null`, `monitoring ≠ true`, `direction: "Outbound"`.
   - `started_at` must fall in `[attempt.started_at − tol, (attempt.ended_at ?? attempt.started_at + 4h) + tol]`.
   - A candidate that is not yet `terminal` makes the result `pending`.
3. **Rep evidence.** At least one `user` party has an `extension_id` and satisfies `connected || party.direction === "Outbound"`. That is the `repDays` rule, **not** `interactionRepIdentity`, which drops unanswered calls.
   - The party must resolve through `resolveRepIdentityAt(links, call.provider_account_id, ext, call.started_at)` to `reviewed`, `sales_rep` and `agent_id === attempt.agent_id`.
   - Any user leg that resolves to `conflicting` or `proposed_only` makes the result `ambiguous(identity_conflict)`.
4. **Uniqueness.**
   - Exactly one candidate must remain; otherwise `ambiguous(multiple_calls)`.
   - No other attempt by **any** Rep on that Number may have a window containing the call; otherwise `ambiguous(multiple_attempts)`.
   - The call must not already be linked (the unique index fences this too).
5. **Default.** Anything else is `unmatched(no_candidate)`. The attempt is re-evaluated until 36 h after `ended_at`, then `unmatched` is final.

**Link transaction.** It runs as the worker actor (`csiWorkerActor(job_id)`) and does the following:
- CAS on the attempt;
- `evidence = {source: provider_verified, call_interaction_id}`;
- fact `attempt:<id>` gets `verification = provider_verified` and `linked_call_id`;
- fact `call:<id>`, if present, gets `merged_into = "attempt:<id>"`;
- audit `attempt_linked`.

The result is exactly one counted unit per real call (spec acceptance 4).

**Provider facts and re-matching.** `tracker/activityReconcile.ts` runs as recovery `tracker_activity_reconcile` under flag `TRACKER`.
- It keeps a cursor `(updatedAt, _id)` over `call_interactions` using the existing index `call_interaction_updated`, with a 10-minute overlap. The cursor is stored in `SalesIntelligenceSyncState`, scope `sales_activity_reconcile`.
- For each terminal, canonical, Outbound call attributable by the rule above to a reviewed Rep, it upserts fact `call:<id>`:
  - `kind: provider_call`, `verification: provider_verified`;
  - `outcome`:

    | Provider data | Outcome |
    |---|---|
    | `contact_type` `human_conversation` | `answered` |
    | `voicemail`, or a Missed / No Answer result | `no_answer` |
    | Result matches `/busy/i` | `busy` |
    | Not connected and the result matches `/fail\|error/i` | `failed` |
    | Anything else | `unknown` (qualifies for Attempts, never for Contacted) |

  - `lead_ref`: the single open Lead-kind Outreach record whose `primary_contact_number_id` is the call's Number; otherwise null.
  - `merged_into`: set when an attempt already links the call.
- A second cursor over `rep_identity_links.updatedAt` re-evaluates the calls and attempts in the affected window, limited to the last 36 h, so that a retroactive review corrects the facts.
- The fingerprint includes the resolution fingerprint from `resolveRepIdentities`.

### 3.5 Notes

**`sales_outreach_notes`** (`SalesOutreachNote`).

| Field | Type / rule |
|---|---|
| `outreach_id`, `subject_key` | Standard |
| `type` | `general` |
| `audience` | `all \| owner_only`; `owner_only` is for the Owner only |
| `body` | Plain text, 1–2000 characters, stored raw and rendered escaped |
| `author` | `{role: owner \| rep, admin_user_id, agent_id}` |
| `edits` | ≤ 20 entries of `{at, prior_body, by_admin_user_id}` |
| `revision` | Standard |

- Index: `sales_note_outreach {outreach_id:1, createdAt:-1, _id:-1}`.

**Routes**

| Route | Scope | Body |
|---|---|---|
| `GET /outreach/:id/notes?cursor` | Record read scope | Also returns attempt summaries as `rep_summary` items, and Owner `add_note` rows (`owner_note`, **Owner only**) from `sales_intelligence_owner_instructions`. Each item is typed with a `source` label. |
| `POST /outreach/:id/notes` | Record read scope | `{body, audience?}` |
| `POST /notes/:id/commands` | Author only | `{command: "edit", expected_revision, body}` |

- Notes **never** change `last_activity_at`, write an `ownerInstruction`, enqueue `number_refresh` or enter AI evidence (`casefile/build.ts` is unchanged).
- The legacy Owner `add_note` keeps its current behavior.

### 3.6 Live reads for cards and the Owner panel

- **`GET /tracker/overlay?ids=<≤50 comma ids>`** (Rep or Owner). A Rep silently drops ids outside its read scope, so the read never discloses them.
  - It composes S2's own fields with `overlayFields` from the S3, S5 and S6 contributor stubs.
  - It returns `{items: TrackerOverlay[], as_of}`.
  - Rep blockers come from the server; the admin cannot read restrictions.
- **`GET /overview/tracker?agent_id?`** (Rep forced to its own row; Owner gets every roster Agent). Rows are `TrackerRepRow[]`, built in batches with one query per source for all Agents; there are no per-Agent queries.
  - Sources:
    - active attempts;
    - non-terminal provider calls from the last 4 h (the `live_call` filter), with the Rep resolved through links;
    - `call_progress.state = "in_progress"` records by responsibility;
    - today's facts;
    - `outreach_agent_state` counts;
    - tracked counts;
    - `new_leads_today` = Lead-kind records assigned to the Agent with `trigger_at` in today's instant bounds.
  - Labels: provider activity is "On the call (telephony)"; a Rep report is "Rep reports reaching out".
  - `provider_verified_calls` and `coverage` come from `readActivity` (`overview/activity.ts:91`), so unknown shows as null.
- **Timeline.** `outreach/timeline.ts` and `story/catalog.ts` map `tracking_set`, `attempt_started|finished|resolved|linked` and `note_added|edited` to the story kinds `tracking`, `attempt` and `note`. Reps see their own attempts and `audience: all` notes. S2 owns these timeline files.
- **DTO.** `toOutreachDto` (`outreach/reads.ts`) adds an optional `tracking` field. Admin `outreachSchema` adds an optional `tracking`. `allowed_actions` in the Outreach DTO does **not** change (`CSI_OWNER_ACTIONS` is untouched), because tracker actions live in the overlay.

### 3.7 S2 admin

**Files** under `components/sales-intelligence/tracker/`:
- `work-mode-control.tsx`
- `reaching-out-panel.tsx`
- `attempt-timer.tsx`
- `outcome-actions.tsx`
- `summary-composer.tsx`
- `attempt-history.tsx`
- `notes-section.tsx`
- `note-editor.tsx`
- `tracker-card-line.tsx`
- `live-rep-rows.tsx`
- `call-state-chips.tsx`
- `use-attempts.ts`
- `use-tracker-overlay.ts`
- `use-overview-tracker.ts`
- `intents.ts`

The API client is `lib/api/salesIntelligenceTracker.ts`.

**URL state.** `data/url-state.ts` gets the key `work_mode`, with values `all | outreach | tracked`, default `all`. It is added to `DeskUrlState`, `RESETS_CURSOR` and `attentionParamsFromDesk`, and is sent only when the capability is on. `clearDeskFilters` keeps it.

**Commands** follow the `CommandDialog` rules:
- one `crypto.randomUUID()` per intent;
- an unknown outcome is retried with the same key;
- `REVISION_CONFLICT` keeps the draft.

After a command, invalidate **narrowly**: `attempts`, `tracker-overlay`, `overview-tracker` and `notes`. Never invalidate `salesIntelligenceKeys.all` (D9).

**Motion.**
- Track, after server confirmation: `si-motion-track-out`, plus an Undo toast that sends the inverse command.
- Return: the neutral `si-motion-return`.
- An attempt result never removes the card.
- The timer computes elapsed time from server `started_at` plus the difference between `as_of` and the client clock at fetch time. It never uses the browser clock alone.

## 4. Slice 3: internal messaging, instructions and notifications

### 4.1 Models (`models/salesIntelligence/inbox.ts`)

**`sales_threads`**

| Field | Type / rule |
|---|---|
| `kind` | `outreach \| rep` |
| `agent_id` | Required |
| `outreach_id` | null for `rep` threads |
| `created_by` | Actor |
| `last_seq` | Count |
| `last_message_at`, `revision` | Standard |

- Indexes:
  - unique `sales_thread_identity_unique {kind:1, agent_id:1, outreach_id:1}`;
  - `sales_thread_agent_recent {agent_id:1, last_message_at:-1, _id:-1}`;
  - `sales_thread_recent {last_message_at:-1, _id:-1}`.

**`sales_messages`** (append-only)

| Field | Type / rule |
|---|---|
| `thread_id` | Required |
| `seq` | Thread `last_seq + 1`, allocated by CAS on the thread |
| `author` | `{role, admin_user_id, agent_id}` |
| `body` | 1–2000 characters, plain text |
| `kind` | `message \| instruction_issued \| instruction_event \| help_request` |
| `instruction_id` | Or null |
| `created_at` | Standard |

- Indexes:
  - unique `sales_message_seq_unique {thread_id:1, seq:1}`;
  - `sales_message_instruction {instruction_id:1, seq:1}`.

**`sales_instructions`** (`SalesInstruction`; the name is distinct from the existing Owner instruction ledger)

| Field | Type / rule |
|---|---|
| `agent_id`, `thread_id` | Standard |
| `outreach_id`, `followup_id`, `lead_ref` | Optional references |
| `body` | 1–1000 characters |
| `rule` | Discriminated union: `call_lead` · `call_leads_target{target: 1..500, include_earlier: false}` · `complete_followup` · `refresh_granot` · `add_summary{attempt_id}` · `free_form` |
| `evidence` | `any \| provider_verified` |
| `window` | `SalesWindow` or null; required for `call_leads_target`, defaulting to today |
| `due_at` | Date or null |
| `state` | `open \| in_progress \| fulfilled \| cancelled \| expired` |
| `acknowledged_at` | Date or null |
| `issued_at`, `issued_by` | Standard |
| `rule_revision` | Integer |
| `edits` | Entries of `{rule_revision, at, by, prior, next}` |
| `completion` | `{basis: evidence \| rep_confirmation, at, note, fact_keys[] ≤ 200}` or null |
| `cancel` | `{at, by, reason}` or null |
| `revision` | Standard |

- Indexes:
  - `sales_instruction_agent_state {agent_id:1, state:1, due_at:1}`;
  - `sales_instruction_outreach {outreach_id:1, state:1}`;
  - `sales_instruction_window {state:1, "window.end":1}`.

### 4.2 Routes

| Route | Who | Body / query | Notes |
|---|---|---|---|
| `GET /threads?kind&outreach_id&cursor` | Rep (its own Agent) / Owner | | An outreach thread is visible to a Rep **only while the record is in its read scope**. Participation is never a bypass. |
| `POST /threads` | Rep (its own Agent) / Owner | `{kind, agent_id?, outreach_id?}` | Get or create by identity; `agent_id` is forced for a Rep |
| `GET /threads/:id/messages?after_seq&limit` | Participant, subject to current scope | | |
| `POST /threads/:id/messages` | Participant | `{body}` | Notifies the other party (kind `message`) |
| `POST /instructions` | **Owner** | `{agent_id, outreach_id?, followup_id?, body, rule, evidence?, window?: {period_kind, anchor_day?, from_day?, through_day?}, due_at?, assign?: {expected_revision}}` | The recipient must be an active roster Agent (`roster.ts`). With `outreach_id` and no `assign`, `responsible_agent_id` must equal `agent_id`, else `ILLEGAL_TRANSITION`. With `assign`, `applyOwnerCommandInTransaction(outreach_id, {command:"assign", expected_revision, responsible_agent_id: agent_id}, ctx)` runs in the **same** transaction first. If it returns `blocked`, return that response and create nothing else. Then: thread get-or-create, message `instruction_issued`, `instruction_actionable` notification. |
| `GET /instructions?agent_id&state&outreach_id&cursor` | Rep (its own) / Owner | | Live `progress {count, target, remaining, label}` from `evaluateProgress`. When a Rep has lost scope on the record, the item shows `access: "revoked"` and omits body and subject. |
| `POST /instructions/:id/commands` | Rep: `acknowledge`, `start` (free-form), `complete {note}` (free-form only, basis `rep_confirmation`), `reply {body, needs_help?}` · Owner: `edit {body?, rule_params?, window?, due_at?}`, `cancel {reason}` | always `expected_revision` | A reply never fulfils an instruction. `edit` bumps `rule_revision`, appends to `edits` and recalculates visibly. `cancel` stops all further progress. |
| `GET /notifications?filter=unread\|all&action=actionable\|completed\|any&cursor&limit` | Rep: `agent:<id>` · Owner: `owner` | | Returns `unread_count`, `actionable_count` and `latest_seq`. Items outside current scope show a sanitized receipt. |
| `POST /notifications/read` | Same | `{through_seq}` **or** `{ids: ≤100}` | The watermark advances only to the `latest_seq` the client saw, so a newer item stays unread (acceptance 8). Mark-read never fulfils work. |

### 4.3 Fulfilment

`inbox/progressHook.ts` `evaluateInstructionsForAgent(agentId, now)` runs from the progress job, and again from recovery `inbox_instruction_sweep` for expiry.

| Rule | Fulfilled when |
|---|---|
| `call_lead` | A qualifying fact with the same `lead_ref`, `since = issued_at` |
| `call_leads_target` | `distinct_leads_attempted ≥ target`; `since` is `issued_at` unless `include_earlier` |
| `complete_followup` | `outreach_followups` shows `status: "completed"` with `completed_at ≥ issued_at` |
| `refresh_granot` | A `granot_refresh` fact for the `outreach_id` since `issued_at` |
| `add_summary` | Fact `attempt:<id>.has_summary` |
| `free_form` | Explicit `complete` only |

- `in_progress` starts when progress first becomes greater than 0.
- Fulfilment:
  - CAS on the instruction;
  - `completion.fact_keys`;
  - `resolveSalesNotifications(instruction_actionable)`;
  - `instruction_fulfilled` sent to the Owner, left unread;
  - audit.
- Expiry happens at `window.end`, with the progress achieved so far retained.

### 4.4 S3 admin

**Files** under `components/sales-intelligence/inbox/`:
- `inbox-button.tsx`, which shows the unread badge;
- `inbox-sheet.tsx`, which uses `Sheet` full-screen at ≤ 480 px;
- `notification-list.tsx`;
- `instructions-section.tsx`;
- `instruction-card.tsx`, which shows `11 of 15 · 4 left` from the server;
- `instruction-composer.tsx`;
- `thread-view.tsx`, which reuses `chat/Thread`, `Composer` and `UnreadDivider`;
- `use-inbox.ts`;
- `intents.ts`.

The API client is `lib/api/salesIntelligenceInbox.ts`.

The existing `rep/owner-messages.tsx` and the Owner `MessagesLive` (nudges) stay: they are external messaging and are labelled that way.

## 5. Slice 4: goals, credit, compensation and earnings

### 5.1 Models (`models/salesIntelligence/goals.ts`)

**`sales_goals`**

| Field | Type / rule |
|---|---|
| `agent_id` | Required |
| `origin` | `personal \| owner_target` |
| `created_by` | Actor |
| `metric` | `SALES_METRICS` plus `earned_commission` |
| `target` | Integer > 0; money targets are in minor units |
| `unit` | `count \| minor_units` |
| `currency` | `"USD"` or null |
| `window` | `SalesWindow` |
| `evidence` | `any \| provider_verified` |
| `rule_version` | `"sales-goal-v1"` |
| `state` | `active \| ended \| cancelled` |
| `result` | `met \| missed` or null |
| `achievement_state` | `none \| achieved \| adjusted` |
| `edits[]`, `revision` | Standard |

- Indexes:
  - `sales_goal_agent {agent_id:1, state:1, "window.end":1}`;
  - `sales_goal_window {state:1, "window.end":1}`.

**`sales_goal_achievements`** (append-only)
- Fields: `achievement_key` = `goal:<id>:<seq>`, `goal_id`, `goal_revision`, `seq`, `kind` (`achieved | adjusted_below | reachieved`), `progress`, `target`, `at`.
- Unique index: `sales_goal_achievement_unique {achievement_key:1}`.

**`sales_credit_entries`** (append-only ledger)
- Fields:
  - `credit_key` = `deal:<bookingId>:<agentId>`;
  - `seq`;
  - `entry_kind`: `recognized | reversed | adjusted`;
  - `share_minor` (signed delta), `net_share_minor`, `split_count`;
  - `booking_id`, `agent_id`, `lead_ref`;
  - `booking_created_at`, `book_date`;
  - `cancelled_lead_id`, `source_fingerprint`, `rule_version: "sales-credit-v1"`;
  - `recorded_at`.
- Unique index: `sales_credit_entry_unique {credit_key:1, seq:1}`.
- Index: `sales_credit_agent {agent_id:1, booking_created_at:1}`.

**`sales_compensation_policies`**

| Field | Type / rule |
|---|---|
| `version` | Integer; unique `sales_comp_policy_version_unique` |
| `state` | `draft \| active \| retired` |
| `effective_from` | New York day, **not before the activation day** |
| `effective_to` | New York day or null |
| `currency` | `"USD"` |
| `recognition_event` | `"official_booking_created"` (the only v1 value) |
| `cancellation_treatment` | `"reverse_full"` |
| `correction_treatment` | `"reverse_and_rerecognize"` |
| `percent_of_binder_bps` | Integer 0–10000, or null |
| `fixed_per_booking_minor` | Integer ≥ 0, or null; at least one of the two is required |
| `applies_to` | `{all: true}` or `{agent_ids[]}` |
| `created_by`, `activated_by`, `activated_at`, `revision` | Standard |

There is **no default rate**.

**`sales_earning_entries`** (append-only)
- Fields: `credit_entry_id`, `agent_id`, `policy_version`, `amount_minor` (signed), `basis: {share_minor, percent_bps, fixed_minor}`, `rounding: "half_away_from_zero_minor"`, `recognized_at`.
- Unique index: `sales_earning_entry_unique {credit_entry_id:1}`.
- Index: `sales_earning_agent {agent_id:1, recognized_at:1}`.

### 5.2 Credit projector (`goals/creditProjector.ts`)

The projector runs as recovery `goals_credit_projector` under flag `GOALS`.

**Desired state** for each `(booking, allocation.agent)` with `binder_amount > 0`:
- `active = booking exists && !booking.cancelled && no cancelled_leads row`;
- `share_minor = dollarsToMinor(binder_amount)`.

Referral and leadless Bookings count. Credit attribution follows the allocation, never the Outreach assignee.

**Comparison.** The projector compares the desired state with fact `deal:<b>:<a>`. When they differ, one transaction:
1. appends a ledger entry (`recognized`, `reversed` or `adjusted`, with `seq = fact.revision + 1`);
2. updates the fact by CAS;
3. enqueues progress evaluation.

**Triggers.**
- **Incremental cursors** over `booked_leads` and `cancelled_leads` on `(updatedAt, _id)`, with a 5-minute overlap. They use new non-unique indexes built by the S1 ops script; these collections sit outside CSI, so their `autoIndex` setting is left as it is.
- **Nightly full reconcile**, under the lease `sales-tracker:credit-reconcile:<NY day>`. It covers:
  - Bookings created in the last 400 days;
  - active facts whose Booking has disappeared (deletion becomes a reversal);
  - reinstated cancellations (a deleted cancellation becomes a re-recognition).
- **Never** read Daily Operations facts, `outcomes.ts`, the name-keyed analytics or `receiver_agent`.

**Earnings projector** (`goals/earningsProjector.ts`, flag `COMPENSATION`). For each credit entry that has no earning entry:
- `recognized`: find the active policy covering `booking_created_at` and the Agent.
  - None: no entry; the credit counts as unconfigured.
  - More than one: `invalid`; no entry.
  - Otherwise: `amount = percentOfMinor(share, bps) + (fixed ?? 0)`.
- `reversed`: negate the net earned so far for the key.
- `adjusted`: reverse the prior net, then recognize the new share under the **originally pinned** policy version.

A rate edit never reprices history: rates change by activating a new version.

### 5.3 Routes

| Route | Who | Notes |
|---|---|---|
| `GET /goals?agent_id&state&cursor` | Rep (its own) / Owner | Live progress from facts; `earned_commission` goals show `status: unconfigured \| not_activated` when unavailable |
| `GET /goals/:id` | Same | Contributors page (facts) and achievements |
| `POST /goals` | Rep: a personal goal for itself · Owner: `owner_target` for a roster Agent | `{agent_id?, metric, target, window, evidence}` |
| `POST /goals/:id/commands` | Creator's role only | `edit {target?, window?, evidence?}` or `cancel {reason?}`, with `expected_revision` |
| `GET /earnings?period&from&through&agent_id?` | Rep (its own) / Owner | See the fields below |
| `GET /compensation-policies`, `POST /compensation-policies` | **Owner** | A create is always a draft |
| `POST /compensation-policies/:id/commands` | **Owner** | See the commands below |

`GET /earnings` returns:
- `status: not_activated | unconfigured | invalid | active`;
- `booked_binder_credit_minor`;
- `earned_commission_minor` (or null);
- `estimated_commission_minor: null` with `estimated_basis: "not_supported"`;
- `paid: {status: "unavailable"}`;
- `unconfigured_credit_count`;
- `entries` (cursor).

Split credit carries a `split_count` label.

`POST /compensation-policies/:id/commands` accepts:
- `edit_draft`;
- `activate {confirm_rates: true}`. This needs `COMPENSATION` on, no overlap (`POLICY_OVERLAP`) and a configured rate (`SETUP_REQUIRED`).
- `retire {effective_to}`.

**Achievements** (`goals/progressHook.ts`):
- Progress reaching the target while `achievement_state ≠ achieved` appends `achieved` (or `reachieved`) and sends `goal_achieved`.
- Progress falling below the target while `achieved` appends `adjusted_below` and sends `goal_adjusted`.
- Recovery `goals_window_sweep` ends windows as `met` or `missed`, using DST-correct windows.

### 5.4 S4 admin

**Files** under `components/sales-intelligence/goals/`:
- `goals-block.tsx` (Overview)
- `goal-card.tsx`
- `goal-composer.tsx`
- `achievement-list.tsx`
- `earnings-block.tsx`
- `compensation-settings.tsx` (Owner; an Overview disclosure)
- `use-goals.ts`

The API client is `lib/api/salesIntelligenceGoals.ts`.

A celebration animates only an **achievement id** that is new after load (`achievement-memory.ts`).

## 6. Slice 5: Granot Case File

### 6.1 Provider adapter (no Outreach knowledge)

| Module | Contract |
|---|---|
| `src/services/granotHttpCollector/session.ts` | Move `GranotHttpClient`, `readFormAction` and `readFormValues` out of `index.ts:479,629,636` and export them unchanged. Add `loginGranotSession(client, creds) → {mainHtml, sessionToken}` and `readGranotCredentials()`, moved from the private `runWorkflow.ts:1003` `readCredentials`. `collectGranotReportOnce` calls `loginGranotSession`. `pnpm test:granot` must stay green unchanged. |
| `src/services/granotJobPage/navigation.ts` | `openJobByNumber(session, jobNumber)`. It finds the form whose action matches `/\?mv~searchret~[0-9a-f-]{36}~QSEARCH$/i` and that has `[name=VALUE]`, then POSTs **only** `{VALUE}`. Wrap the client with `assertAllowedOperation(url)`, applied to **every** redirect hop. The allowlist is `mp~NetLogonWc`, the login form actions and `mv~searchret~*~QSEARCH`. Deny `UpdValue`, `mpcharge~*` and everything else. `parseLocatorHint(url)` requires the HTTPS host `eagle.hellomoving.com`. It rejects userinfo, IP literals, fragments and non-standard ports, drops UUID tokens, and returns `{job_number}` or `LOCATOR_HAS_NO_STABLE_JOB`. **A pasted URL is never fetched.** |
| `granotJobPage/classify.ts` | `classifyGranotPage(html)` returns `security_alert \| close_window \| login \| job_page \| search_miss \| unknown`. A `job_page` requires `input[name=I1TOTAL]` and `#dept`. |
| `granotJobPage/identity.ts` | `observedJobNumber(html)` reads the `#dept` label plus the following digits, with `<title>` as secondary evidence. `verifyJobIdentity` requires `jobNumbersEquivalent(requested, observed)` **and** an exact prefix when one was requested. |
| `granotJobPage/parser/{controls,charges,labels,inventory,envelope,coverage}.ts` | Cheerio parsing; scripts never run. Export `PARSER_VERSION = "granot-charges-v1"`. Envelope fields are `{state: present \| blank \| unknown \| unavailable \| invalid \| redacted, raw, value, locator: {section, control, occurrence}, method: observed \| derived}`. Money is a decimal string converted to minor units, with thousands separators stripped and raw text kept. `Balance:` is an **observed labelled** value. Dates `MM/DD/YYYY` become `YYYY-MM-DD` with no instant. Inventory row, quantity and ft³ sums must match the header totals (fixture: 24 / 106 / 870); ft³ is never multiplied by quantity. |
| `granotJobPage/fixtures/` | Sanitized derivatives only: synthetic UUIDs and synthetic contact details, the 529-byte security page and the ~120-byte Close Window page. **Never commit `docs/granot_job_page.html`**, because it contains a real session token. |

### 6.2 Models (`models/salesIntelligence/caseFile.ts`)

**`granot_case_file_refreshes`**

| Field | Type / rule |
|---|---|
| `dataset` | Standard |
| `outreach_id` | Required |
| `account_key` | Required |
| `job_key` | Normalized requested Job Number |
| `mode` | `known_job \| url_hint \| job_number` |
| `requested_by` | `{role, admin_user_id, agent_id}` |
| `request_hash` | Standard |
| `state` | `queued \| running \| succeeded \| partial \| unchanged \| retry_wait \| identity_review \| auth_required \| failed \| cancelled` |
| `phase` | `authenticating \| discovering \| fetching \| parsing \| validating \| publishing` |
| `active` | Boolean |
| `attempt_count`, `next_retry_at`, `reason_code` | Standard |
| `result` | `{snapshot_ids[], published_head_revision, changed_sections[], retained_sections[]}` |
| `lease_epoch`, `finished_at`, `revision` | Standard |

- Unique `granot_refresh_active_unique {account_key:1, job_key:1}`, partial `{active: true}`. Equivalent requests **join** the active refresh.
- TTL `granot_refresh_ttl {finished_at:1}`: 90 days.

**`granot_job_snapshots`** (immutable)
- Fields follow recommendation §5: `identity`, `page_kind`, `refresh_id`, `retrieved_at`, `parser_version`, `schema_version`, `sanitizer_version`, `content_hash`, `semantic_hash`, `facts`, `coverage`, `diagnostics`, `superseded_at`.
- Indexes:
  - unique `granot_snapshot_attempt_unique {refresh_id:1, page_kind:1, parser_version:1}`;
  - `granot_snapshot_scope {"dataset.deployment":1, "dataset.database":1, account_key:1, resolved_job_key:1, page_kind:1, retrieved_at:-1, _id:-1}`;
  - `{content_hash:1}`.
- Retention: TTL on `superseded_at`, 365 days. `superseded_at` is set only once no head section points to the snapshot.

**`granot_job_heads`**
- Fields: `selected_sections.<section> = {snapshot_id, verified_at}`, `verified_record_link`, `last_attempt`, `facts_revision`, `active_refresh_id`, `last_verified_at`, `revision`.
- Unique `granot_head_unique {"dataset.deployment":1, "dataset.database":1, account_key:1, resolved_job_key:1}`.
- `resolved_job_key = "granot:<account_key>:<normalizedJobNo>"` (one account in v1).

**`granot_job_sources`** holds the sanitized HTML for parser diagnosis. TTL `expires_at` is 30 days.

### 6.3 Flow and publication

1. **`POST /outreach/:id/case-file/refresh`** takes `{mode, url_hint?: ≤2048, job_number?: ≤16}`.
   - `known_job` requires record read scope.
   - `url_hint` and `job_number` require strict assignment.
   - Flag `GRANOT_ACQUISITION` must be on and `GRANOT_JOB_PAGE_ACCOUNT_KEY` and `GRANOT_JOB_PAGE_CURRENCY` must be set; otherwise the answer is 503 `GRANOT_ACQUISITION_UNAVAILABLE` or `SETUP_REQUIRED`.
   - A successful refresh of the same `job_key` less than 5 minutes ago answers `RATE_LIMITED`.
   - The server never stores or logs the URL. It keeps only the parsed hint.
   - It inserts or joins the refresh and enqueues `granot_case_file_refresh` with `input_refs: [refresh_id]` and dedupe `csi:granot-refresh:<id>`.
   - The answer is **202** with `{refresh_id, state, coalesced}`.
2. **Worker** (`caseFileView/worker.ts`):
   - It re-authorizes and reloads the contract.
   - It takes the shared `granot:automation:account` lease with a 3-minute TTL. If automation holds it, `failCsiJob(…, "lease_busy", 60s)`.
   - It logs in freshly, navigates, classifies and parses. One re-login is allowed per attempt. At most 3 attempts are made for `provider_error`.
   - Bad credentials give `auth_required` and pause the account.
3. **Identity gate.** The page Job Number must equal the requested one. The requested one must equal the Outreach Lead's `normalized_job_no` **or** an active `GranotRecordLink` for that Lead, whose revision is recorded. Phone equality **never** authorizes. On a mismatch: `identity_review`, a `granot_identity_review` notification, and **nothing is published**.
4. **Publish** in one transaction, fenced by the CSI job lease epoch and a CAS on `head.revision`:
   - Insert the snapshot.
   - Update section pointers only for `complete_for_page` sections. Failed or partial sections keep their prior pointer.
   - Identical `semantic_hash`: only bump `last_verified_at`.
   - Upsert fact `granot_refresh:<id>` (for `refresh_granot` instructions).
   - Audit kind `case_file`.
   - Do **not** trigger AI reanalysis: `casefile/` and `caseFileInputFor` are unchanged in this program.
5. **Reads**:
   - `GET /outreach/:id/case-file` returns `CaseFileView v1`, recommendation §8, with the `allowed_actions` `refresh` and `provide_url`. Record read scope; no network access and no writes.
   - `GET /outreach/:id/case-file/refreshes/:refreshId` and `GET /outreach/:id/case-file/history?cursor` also use record read scope.
   - Job binding is derived: Outreach, then Lead `normalized_job_no` or an active Record Link, then the head. No separate binding store exists.

### 6.4 S5 admin

**Files** under `components/sales-intelligence/case-file/`:
- `granot-sections.tsx`
- `field-value.tsx` (value plus a provenance or state chip)
- `coverage-chips.tsx`
- `inventory-table.tsx`
- `refresh-control.tsx` (Work rail: a URL field and Refresh)
- `refresh-status.tsx` (honest queued, running or failed states; polls with backoff only while active)
- `use-case-file.ts`

The API client is `lib/api/salesIntelligenceCaseFile.ts`. `MoveGlance` and `MoveDetailsSection` keep reading `move_summary`.

## 7. Slice 6: economics and day view

### 7.1 Assignment cost (`economics/assignmentCost.ts`)

**`GET /overview/assignment-cost?period&from&through&priority`** is **Owner-only** (flag `ASSIGNMENT_COST`). The algorithm is pure (`buildAssignmentCost`) and reads everything in batches:

1. **Period and cohort.** `readPeriod(key, now, from, through)` (`overview/queryPeriod.ts:12`), then `loadSpendCohort(period, {priority})` **without** `agent_id`.
   - `LEAD_PROJECTION` (`overview/spend.ts:109`) gains `lead_source_company`, `source_granularity_id` and `source_company_label_snapshot`. The change is additive; the receiver report's output is asserted unchanged.
2. **Outreach resolution.** For each model, run `outreach_records.find({"subject.kind":"lead","subject.model":M,"subject.id":{$in: chunk ≤ 1000}}, {subject, responsible_agent_id, revision})`. This uses the prefix of `outreach_subject_unique`. Number Review records are never read.
3. **Bucket assignment.**

   | Condition | Bucket (reason) |
   |---|---|
   | No record | Unassigned (`no_outreach`) |
   | `responsible_agent_id` is null | Unassigned (`unassigned`) |
   | The Agent is missing from `agents` | Unresolved (`unknown_agent`) |
   | More than one record, or the Lead appears under both models | Unresolved (`multiple_records`) |
   | Otherwise | The responsible Agent's bucket |

   Tracking membership plays no part.
4. **Cents.** Use `spendBasis` → cents with no repricing. Keep the counts for `unpriced`, `zero` and `legacy`.
5. **Grouping.** Company, then Source Company **id**, then Source Granularity **id**, then Rep. Labels come from snapshots and are for display only.
6. **Invariant.** For the company and **every** source node, `company_cents === Σ rep + unassigned + unresolved`. A failure answers `reconciliation: {ok: false, diff_minor}`, is logged, and is never hidden.

The response is `{as_of, period, label: "Current assignment of Leads received in this period", company, by_source[], by_rep[], unassigned, unresolved, reconciliation, transfers: {count}}`. All money is `*_minor`.

The existing receiver-attributed `SpendBlock` and `/overview` stay unchanged.

### 7.2 Transfers, day strip and opportunity

- **`sales_assignment_transfers`** (`models/salesIntelligence/economics.ts`)
  - Fields: `audit_event_id`, `outreach_id`, `lead_ref`, `lead_timestamp`, `from_agent_id`, `to_agent_id`, `actor: {kind, id}`, `origin`, `happened_at`, `outreach_revision`.
  - Indexes:
    - unique `sales_transfer_audit_unique {audit_event_id:1}`;
    - `sales_transfer_lead_time {lead_timestamp:1}`;
    - `sales_transfer_agent_time {to_agent_id:1, happened_at:-1}`.
  - **Projector** (`economics/transferProjector.ts`, recovery `economics_transfer_projector`):
    - Cursor over the audit stream `(recorded_at, _id)` using `csi_audit_stream`, filtered to `invalidation.kind: "outreach"`.
    - A row is a transfer when `prior.responsible_agent_id ≠ current.responsible_agent_id`.
    - It also emits an `assignment` notification to the new Agent.
    - It is rebuildable by resetting the cursor.
- **`GET /overview/assignment-transfers?period&agent_id&cursor`** is Owner-only.
- **`GET /overview/day`** is Owner-only.
  - It returns `{day, leads_today, texts: {sent, held_now, failed}, official_bookings}` from `getDailyOperationsSnapshot()` (`dailyOperations/snapshot.ts:110`), each labelled with its source.
  - `completed_attempts`, `provider_confirmed_calls` (from `readActivity`, where unknown is null) and `goal_completions` (today's achievements) come from the kernel.
  - Daily Operations tiles refresh on a 30 s visible-page poll. Their collections are not watched.
- **Opportunity** (`economics/opportunity.ts`) is the observed gross value. It prefers the Job Page head `estimate.total` when S5 is present; otherwise it uses the report-observation `move_summary.granot.estimate` (source `granot_report`). Only Jobs with a verified identity (`normalized_job_no`) are summed, deduplicated by that key. Jobs without it count as `unidentified_count`.
- **`economics/contributors.ts`** fills `overlayFields.opportunity` and `repRowFields.cost`.
- **Rep redaction.** `GET /outreach/:id` strips `lead_cost` server-side for a Rep. This edits `routes/sales-intelligence-admin.routes.ts:481-491`, where it already strips nudges; S6 owns that edit. The UI already hides the field, so nothing visible changes. Whether a Rep keeps "Your Lead spend" is an open decision (§15).

### 7.3 S6 admin

**Files** under `components/sales-intelligence/economics/`:
- `day-strip.tsx`
- `assignment-cost-block.tsx`
- `cost-breakdown-table.tsx` (drillable company → source → granularity → Rep → Leads)
- `transfer-list.tsx`
- `use-economics.ts`

The API client is `lib/api/salesIntelligenceEconomics.ts`. A reassignment animates as a **transfer**, never as new spend.

## 8. Slice 7: release

- **Performance tests.**
  - `tracker/overviewTracker.perf.test.ts` and `economics/assignmentCost.perf.test.ts`: 50 Agents, 10,000 records or Leads, pure builders, following `overview/teamIntelligence.test.ts:67`.
  - Local replica timings: the p95 from a committed command to SSE frame to refetch is ≤ 2 s, and assignment cost is ≤ 5 s.
- **Accessibility.** A 390 px and keyboard pass covers visible focus, `aria-live` announcements, drafts kept across refetches (`useListRefresh`) and no reordering under the pointer.
- **Multi-session walk.** An Owner and two Reps run scenarios 1–18. Use Playwright if approved (`e2e/`, `*.spec.ts`, outside the `node --test` glob); otherwise run the scripted manual walk against `scripts/dev_ops/serve-csi-local.ts` with `x-csi-local-actor`.
- **Rollback rehearsal.** Turn each flag off, then roll back admin, then the server, on the local replica.
- **Docs.** Promote every Service doc from `draft` to `active`.

## 9. Real-time contract

### 9.1 Server (S1 lands all of it in `src/services/salesIntelligence/live.ts`)

| Collection | Topic | Rep-visible |
|---|---|---|
| `sales_attempts` | `attempt` | yes |
| `sales_outreach_notes` | `note` | yes |
| `sales_contribution_facts`, `sales_goals`, `sales_goal_achievements` | `goal` | yes |
| `sales_threads`, `sales_messages`, `sales_instructions`, `sales_notifications`, `sales_notification_read_states` | `inbox` | yes |
| `sales_credit_entries`, `sales_earning_entries`, `sales_compensation_policies` | `earnings` | yes (reads are scoped) |
| `granot_job_heads`, `granot_case_file_refreshes` | `case-file` | yes |
| `sales_assignment_transfers`, `form_leads`, `call_leads` | `cost` | **no** |

- Snapshots, sources, counters and the ledger's own collection are **not** watched.
- `REP_LIVE_TOPICS` becomes `{attention, outreach, analysis, number, attempt, note, goal, inbox, earnings, case-file}`.
- Frames stay version 2 and carry slugs only. Privacy still comes from the scoped reads.

### 9.2 Admin (S1 lands all of it)

**New topics** in `salesIntelligenceTopicKeys`:

| Topic | Segments |
|---|---|
| `attempt` | `attempts`, `tracker-overlay`, `overview-tracker`, `timeline`, `overview-day` |
| `note` | `notes`, `timeline` |
| `goal` | `goals`, `goal-detail`, `instructions`, `overview-tracker`, `overview-day` |
| `inbox` | `threads`, `thread-messages`, `instructions`, `notifications`, `tracker-overlay`, `overview-tracker` |
| `earnings` | `earnings`, `compensation-policies`, `goals`, `goal-detail` |
| `case-file` | `case-file`, `case-file-refresh`, `case-file-history`, `tracker-overlay` |
| `cost` | `assignment-cost`, `assignment-transfers`, `overview-day`, `overview-outcomes` |

**Additions to existing topics** (pinned test expectations are unaffected):

| Topic | Added segments |
|---|---|
| `outreach` | `tracker-overlay`, `overview-tracker`, `assignment-cost`, `instructions`, `overview-team` |
| `number` | `overview-tracker`, `overview-activity`, `attempts` |
| `attention` | `overview-team` |

**`siKeys` builders** follow the pattern `[...all, <segment>, …]`:
- `attempts(outreachId)` and `activeAttempt()`, whose key is `'attempts', 'active'`;
- `notes(outreachId)`;
- `trackerOverlay(ids)`, with the ids sorted and comma-joined;
- `overviewTracker(agentId | null)`;
- `threads(query)`, `threadMessages(threadId)`, `instructions(query)`, `notifications(query)`;
- `goals(query)`, `goal(goalId)`, which uses the segment `goal-detail`;
- `earnings(query)`, `compensationPolicies()`;
- `caseFile(outreachId)`, `caseFileRefresh(outreachId, refreshId)`, `caseFileHistory(outreachId, cursor)`;
- `assignmentCost(query)`, `assignmentTransfers(query)`, `overviewDay()`;
- `overviewTeam(query)`, `overviewActivity(query)`, `overviewOutcomes(query)`.

**Reconnect.** Behavior stays as it is: a full resync (`salesIntelligenceInvalidationKeys`).

**Cached records after reassignment.** A forbidden or 404 refetch of an `outreach`, `attempts`, `notes`, `case-file` or `instructions` key **removes** that query (`client.removeQueries`) and shows a "No longer assigned to you" state. S2 adds this to `useOutreachGate`.

## 10. File ownership

**Rule:** a slice creates and edits only the files it owns. Shared files are edited by S1 alone, except for the delimited exceptions listed below.

| Owner | New files (server) | New files (admin) |
|---|---|---|
| S1 | `routes/sales-intelligence-route-context.ts`; the 5 route registrar stubs; `models/salesIntelligence/{contributions,notifications}.ts` plus the 5 area model stubs; `services/salesIntelligence/{contributions/*,notifications/*,salesAreas.ts,jobDrain.ts}`; the 5 `*/manifest.ts` and 4 `*/contributors.ts` and `progressHook.ts` stubs; `ops/sales-rep-tracker-indexes.ts`, `ops/lib/sales-rep-tracker-indexes.ts`, `ops/sales-rep-tracker.replica.ts`, `ops/replica/sales-rep-tracker/foundation.replica.test.ts` | `server/auth/rep-routes/*.ts` stubs; `data/use-sales-features.ts`; `motion/*`; the 5 `*/slots.tsx` and `*/copy.ts` stubs; the 5 gallery section stubs |
| S2 | `routes/sales-intelligence-tracker.routes.ts`, `models/salesIntelligence/tracker.ts`, `services/salesIntelligence/tracker/*`, `validation/v1/salesTracker.ts`, `ops/replica/sales-rep-tracker/tracker.replica.test.ts` | `components/sales-intelligence/tracker/*`, `lib/api/salesIntelligenceTracker.ts`, `server/auth/rep-routes/tracker.ts`, `tests/sales-intelligence/tracker-*.test.ts` |
| S3 | `…-inbox.routes.ts`, `models/…/inbox.ts`, `services/…/inbox/*`, `validation/v1/salesInbox.ts`, `…/inbox.replica.test.ts` | `inbox/*`, `lib/api/salesIntelligenceInbox.ts`, `rep-routes/inbox.ts`, `tests/…/inbox-*.test.ts` |
| S4 | `…-goals.routes.ts`, `models/…/goals.ts`, `services/…/goals/*`, `validation/v1/salesGoals.ts`, `ops/backfill-sales-credit.ts`, `…/goals.replica.test.ts` | `goals/*`, `lib/api/salesIntelligenceGoals.ts`, `rep-routes/goals.ts`, `tests/…/goals-*.test.ts` |
| S5 | `…-case-file.routes.ts`, `models/…/caseFile.ts`, `services/…/caseFileView/*`, `services/granotHttpCollector/session.ts`, `services/granotJobPage/**`, `validation/v1/caseFileView.ts`, `…/casefile.replica.test.ts` | `case-file/*`, `lib/api/salesIntelligenceCaseFile.ts`, `rep-routes/case-file.ts`, `tests/…/case-file-*.test.ts` |
| S6 | `…-economics.routes.ts`, `models/…/economics.ts`, `services/…/economics/*`, `validation/v1/salesEconomics.ts`, `…/economics.replica.test.ts` | `economics/*`, `lib/api/salesIntelligenceEconomics.ts`, `tests/…/economics-*.test.ts` |

**Existing files edited after S1, with a single owner each:**

| Slice | Files |
|---|---|
| S2 | `models/salesIntelligence/outreach.ts` (the `tracking` field and index); `outreach/attention.ts` (`work_mode`); `outreach/reads.ts` and `dto.ts` (optional `tracking`); `outreach/timeline.ts`, `story/catalog.ts`, `timelineRead.ts`; admin `data/url-state.ts`, `data/use-attention.ts`, `lib/api/salesIntelligence.ts` (optional `tracking`), `outreach/outreach-page.tsx` (`useOutreachGate` purge) |
| S5 | `services/granotHttpCollector/index.ts` and `runWorkflow.ts` (refactor only); `docs/adr/0003-*.md` (amendment); `docs/knowledge/services/granot-http-collector.md` |
| S6 | `overview/spend.ts` (additive projection and `aggregateCohortBy`); `routes/sales-intelligence-admin.routes.ts:481-491` (Rep `lead_cost` strip) |
| S7 | Token additions: `sales-intelligence.css` `:root` tokens and gallery `TOKEN_GROUPS` |

**Shared files with delimited per-slice regions** (the only ones where two slices write to the same file):
- `styles/sales-intelligence.css`: only inside your `/* UI-3: <AREA> start|end */` block.
- `docs/knowledge/services/<area>.md`: each slice owns its own file.
- `CONTEXT.md`: S1 writes all terms. A later slice may edit only the body of its own term.
- Workspace `AGENTS.md`: S7 only.

## 11. Test plan

**Server unit tests** use `node:test`, have no Mongo, and run under the pinned environment. Replica tests run with `pnpm test:sales-tracker:replica`, which needs the Docker `csi01` container on port 27189. Admin tests run with `pnpm test` and live under `tests/sales-intelligence/`; a test placed under `components/**` never runs.

| Slice | Unit tests (proof) | Replica / integration | Acceptance |
|---|---|---|---|
| S1 | `contributions/{windows,money,metrics}.test.ts` (DST spring and fall days, week boundaries, half-away rounding, distinct counting, evidence policy); `notifications/record.test.ts` (identity dedupe, sequence order); `live.test.ts` (new topics, Rep collection filter, `$project`); rep-access matrix still green; `foundation.test.ts` registry; `ops/lib/sales-rep-tracker-indexes.test.ts`; admin `live-topics.test.ts` (new samples plus the `overview-*` fix) | `foundation.replica.test.ts`: notifications race a watermark (a new item stays unread); fact CAS under concurrency | 8 (watermark), 17 (windows) |
| S2 | `tracker/{match,guards,display,providerFacts}.test.ts` (ambiguous, pending and linked; repDays party rule); route tests `sales-intelligence-tracker.routes.test.ts` (Rep strict assignment is `FORBIDDEN`, follow-up-only Rep cannot start or track, 404 on a foreign read); `attention.query.test.ts` `work_mode` digest; `overviewTracker.perf.test.ts`; admin `tracker-work-mode`, `tracker-panel` and `tracker-card` render tests | `tracker.replica.test.ts`: two keys racing give one active attempt; replay with the same key; `IDEMPOTENCY_CONFLICT`; stale sweep; provider call linked once with no double count; official closure beats a racing start; reassignment mid-attempt | 1, 2, 3, 4, 5, 14 (mid-call), 15, 16 (active rows) |
| S3 | `inbox/{rules,progressHook,access}.test.ts` (reply does not fulfil; free-form rep confirmation; edit recalculates); routes test (Rep cannot create instructions and cannot read another Agent's thread) | `inbox.replica.test.ts`: atomic assign plus instruction; "Call 15 Leads" progresses 4 then 11 left, repeats ignored, one fulfilled notification; mark-all-read race; reassignment gives a sanitized receipt | 6, 7, 8, 14, 15 |
| S4 | `goals/{creditProjector,earnings,achievements}.test.ts` (split allocations, zero allocation excluded, cancellation reversal, reinstatement, allocation correction, overlapping or missing policy gives `invalid` or `unconfigured`, no repricing) | `goals.replica.test.ts`: Booking, then cancel, then uncancel, over the ledger; an achievement fires once, is adjusted, then re-achieved; retries do not double | 9, 6 (engine), 8 (no replay), 17 |
| S5 | `granotJobPage/**/*.test.ts` over sanitized fixtures (all expected values from `GRANOT-TEST-EVIDENCE.md`, security, close-window and login pages, malformed money, partial inventory, redirect to a denied operation, locator grammar); `pnpm test:granot` unchanged | `casefile.replica.test.ts` with a fake `fetch`: publish CAS; an older completion never overwrites; identity mismatch goes to review; partial retains the prior section | 12, 13, 14 (mid-fetch), 15 |
| S6 | `economics/assignmentCost.test.ts` (A→B moves $40 and the company total is unchanged; duplicate, no_sync, unpriced and zero Leads; unknown agent goes to unresolved; invariant per node); `assignmentCost.perf.test.ts`; receiver report unchanged | `economics.replica.test.ts`: the transfer projector over the audit stream | 10, 11, 16, 17 |
| S7 | none | Multi-session walk, timing report | 18, all budgets |

## 12. Flags and environment

| Name | Default | Gates | Prerequisite to enable |
|---|---|---|---|
| `SALES_INTELLIGENCE_TRACKER` | off | S2 routes, `work_mode`, sweeps, matching | S1 indexes built |
| `SALES_INTELLIGENCE_INBOX` | off | S3 | S1 and S3 indexes |
| `SALES_INTELLIGENCE_GOALS` | off | S4 goals and credit ledger | S4 indexes; credit backfill dry-run reviewed |
| `SALES_INTELLIGENCE_COMPENSATION` | **off** | Policy activation and the earnings projector | Owner-configured and confirmed rates (**U**) |
| `SALES_INTELLIGENCE_CASE_FILE_VIEW` | off | Case File reads | S5 indexes |
| `SALES_INTELLIGENCE_GRANOT_ACQUISITION` | **off** | Refresh routes and worker | Spec §8 retrieval proof: second job, account and Record Link, all templates (**U**) |
| `SALES_INTELLIGENCE_ASSIGNMENT_COST` | off | S6 routes and projector | S6 indexes; invariant report clean |
| `GRANOT_JOB_PAGE_ACCOUNT_KEY` | unset | An opaque configured account key | Set together with the acquisition flag |
| `GRANOT_JOB_PAGE_CURRENCY` | unset | Currency basis for parsed money (`USD`) | Same |

- Every flag also requires `SALES_INTELLIGENCE_ENABLED`, and Rep access requires `REP_ACCESS`.
- Credentials reuse `GRANOT_NETWORK_USERNAME`, `GRANOT_NETWORK_PASSWORD`, `GRANOT_USERNAME` and `GRANOT_PASSWORD`.
- Document each name in the server `docs/knowledge/environment.md`, §Sales intelligence (S1 writes all entries). Admin has no new environment variables.

## 13. Documentation

**Service docs** (`vantage-main-server/docs/knowledge/services/`, OKF 0.2 frontmatter). Create:
- `sales-rep-tracker.md` (S2)
- `sales-internal-messaging.md` (S3)
- `sales-goals-and-earnings.md` (S4)
- `granot-case-file.md` (S5)
- `sales-assignment-cost.md` (S6)
- `sales-contributions.md` (S1)

Update:
- `sales-intelligence-foundation.md`: Rep route list; the command routes return `FORBIDDEN` (S1).
- `sales-intelligence-live.md`: topics; the 15 s clock frame is a full resync (S1).
- `sales-intelligence-outreach.md`: `tracking`; the note on "live when either is set" (S2).
- `granot-http-collector.md` (S5).
- `agent-allocation.md`: note that the public POST and PATCH accept N-way splits (S4).

Add the catalog rows to `docs/index.md` (S1).

**Glossary** (`CONTEXT.md` §Sales Intelligence, S1). The terms and what each must say:

| Term | Definition to write |
|---|---|
| My Tracker | A work mode of My Outreach, not a list or tab |
| Tracking membership | |
| Sales attempt | Rep-reported, never a call |
| Provider-verified call | |
| Attempt needs resolution | |
| Sales note | |
| Internal thread | |
| Sales instruction | Distinct from the Owner instruction ledger |
| Recipient notification | |
| Goal | |
| Contribution fact | The glossary's "Goal contribution" |
| Achievement | |
| Deal credit | |
| Compensation policy | |
| Earnings entry | |
| Opportunity value | |
| Assignment cost | vs Receiver-attributed spend |
| Assignment transfer | |
| Granot Job Page snapshot | |
| Case File view | The human view; the AI Case File stays |

Each entry carries an `_Avoid_` line.

**Admin docs.**
- `vantage-admin/CONTEXT.md` and `.cursor/rules/project-organization.mdc` get rows for the new `components/sales-intelligence/*` folders (S1). Both files already have uncommitted edits: preserve them.
- Workspace `AGENTS.md` fixes the Daily Operations pointer to `internal_hidden_docs/daily-operations/` (S7).

## 14. Deploy, backfill and rollback

1. **Server S1.**
   - Deploy with all new flags off; the change is additive.
   - Run `node --import tsx ops/sales-rep-tracker-indexes.ts --report`, then `--apply --confirm-production=vantagemovers`.
   - Build the indexes **before** any writer flag is on: unique fences fail closed with `INDEX_REQUIRED`.
2. **Server S2–S6.** Deploy as they merge, flags off. Rerun the index script after each merge.
3. **Admin.** Deploy after the server it consumes. Slots render nothing until `features.*` is true. Old admin builds tolerate the new topics: an unknown topic triggers a full resync.
4. **Enable in this order:**
   1. `TRACKER`;
   2. `INBOX`;
   3. `GOALS`, after `ops/backfill-sales-credit.ts --since <day>` has been dry-run and then applied, with its report reviewed;
   4. `ASSIGNMENT_COST`: the transfer projector backfills from the start of the audit stream in bounded batches;
   5. `CASE_FILE_VIEW`;
   6. `COMPENSATION`, only after rates are confirmed;
   7. `GRANOT_ACQUISITION`, only after the retrieval proof.
5. **Backfills.**
   - Tracking needs **none**: an absent value is outreach mode.
   - Provider-call facts: `tracker_activity_reconcile` starts its cursor at `now − 35 days`.
   - Never invent attempts, instructions, read receipts or earnings from before activation.
6. **Rollback.**
   - Turn the flag off; it takes effect immediately and the UI hides.
   - Then roll back admin, then roll back the server.
   - New collections, snapshots, ledgers and audit rows are kept. Indexes stay.
   - The optional `tracking` field and the optional policy fields are rollback-safe, because older builds never write them and the policy fields are written only while the flag is on.

## 14a. Provider-driven updates (addendum, 2026-09-30)

Added after S7, on `feat/sales-rep-tracker`, at the Owner's request: calls made on RingCentral update the tracker on their own, for the extension linked to each Agent, on the Number of each Outreach record. The engineering contract is the Service doc `vantage-main-server/docs/knowledge/services/sales-rep-tracker.md`, section "Provider-driven updates (2026-09-30)". In short:

1. **Per-call reconcile.** Capture (`persistInteraction.ts` `scheduleTrackerReconcile`) enqueues stage `sales_call_reconcile` for every Call Interaction revision that turns terminal, settles, or changes a fact-relevant field, while `TRACKER` is on; the capture worker and the CC-08 refresh wake it after their commit. The handler (`tracker/callReconcileWorker.ts`) runs `reconcileCalls` on that one call. The 35-day cursor stays the backstop. No per-RingCentral-user subscription: the account-level subscription already carries every extension, and the Heavy rate budget is shared.
2. **Inbound calls count** when the Rep's extension connected and the talk time reaches policy `inbound_call_min_seconds` (default 30). The fact carries `direction` (additive). Matching stays outbound-only.
3. **Auto-finish** (`tracker/autoFinish.ts`): an open attempt is finished from the one call that matches it (S2 matcher) once the provider outcome is determinate and policy `attempt_auto_finish_minutes` (default 3) has passed since the call ended. `resolution.by_role = "provider"` (additive enum value, DTO and admin schema updated), the S2 link transaction, audit `attempt_auto_finished`. `unknown` never finishes an attempt: Rejected is only ever the Rep's word.
4. **Owner event.** Timeline-only audits `provider_call_counted` / `provider_call_uncounted` (kind `attempt`) on the Number's subject key, visible to the Owner and the named Rep. No inbox notification per call.
5. **Admin defaults.** The Outreach lists (Owner and rep) open on upcoming moves (`move_date_mode=today_onward`, written to the URL as a removable chip) sorted by Move date, earliest first (`DESK_DEFAULT_SORT = "move_date"`), on a plain tab switch and on a pristine mount; drills, bookmarks with filters and Closed are untouched (`url-state.ts` `deskDefaultsPatch`).

Rollback: the two new policy fields follow the §14.5 rule for optional policy fields (clear before a server code rollback). The `direction` fact field, `by_role: "provider"` and the three audit kinds are additive; an older build ignores them.

## 15. Open decisions for the user

1. **Compensation.** Rates, fixed amounts, the recognition model and whether backdating is allowed. The v1 default forbids an `effective_from` before activation. Without these, `COMPENSATION` stays off.
2. **Granot live proof.** An authorized second job and Record Link or account verification are needed before `GRANOT_ACQUISITION` can be enabled.
3. **Rep "Your Lead spend".** A Rep's `/overview` shows receiver-cohort spend, which conflicts with spec §3 ("cost is Owner-only"). Recommendation: hide it for Reps. The server-side `lead_cost` strip ships regardless.
4. **Deal window basis.** The design uses Booking `createdAt` (spec §7, "earned at official Booking creation"). Existing sales reports use `book_date`, so the two will differ.
5. **Daily Operations early-morning Lead day bug** (`recordDomainFacts.ts:190`). Fix it separately, or accept that the day strip inherits it.
6. **Environment inventory.** Commit the currently untracked `vantage-main-server/docs/knowledge/environment.md` with S1.
7. **Playwright.** Add it as an admin dev dependency for the multi-session suite, or use the manual walk.
