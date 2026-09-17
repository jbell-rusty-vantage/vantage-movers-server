# Shared contracts and integration handoffs

Status: CSI-01 complete; **G1 foundation contracts frozen** after independent GPT-6 review and resolution of all five substantive findings. Runtime contracts below are the Step 2 handoff. B–E feature services remain unimplemented. Review packet: [STEP2-HANDOFF.md](evidence/csi-01/STEP2-HANDOFF.md). Grok's original handoff remains preserved.

| Contract | Authority | Producer → consumer | Required handoff |
| --- | --- | --- | --- |
| Call identity and evidence | 02 §§1–3; 03 capture | B → C/D/E | Canonical id, projection revision, event/observed time, external number, participants, recording/coverage; duplicate and transfer fixtures. **CSI-02 implemented:** see [CSI-02 concrete imports](#csi-02-concrete-imports-server-relative-september-17). |
| Attachment attribution | 01 §5.2/§6 | C → B/D/E | Exact/Likely/Unsure, scoped subject, blocked reason; no model-selected Lead authority. |
| Transcript version | 02 §6; 10 evidence | B → D/E | Immutable redacted segments/digest, speaker evidence/unknown, complete coverage and media state. |
| Outreach/action commands | 01 §§5–8; 04 | C → D/E | Multiple nullable-due actions, assignments, Owner instruction scopes/revisions, clocks/review/restriction behavior. |
| Envelope schema | 10 §3 | A/D → all | Implemented and frozen: `src/validation/intelligence/intelligenceEnvelope.validation.ts` (`csi-envelope-v1`). Fixtures: `src/validation/intelligence/fixtures.ts`. Schema validation only — not evidence authorization or effect application. |
| Scoped MCP protocol | 10 §2; 04 §6 | D → agent worker | Tool allowlist, credential claims, run subject enforcement, paginated read schemas and snapshot capture. |
| Submission and effects | 10 §§5–8 | D + C → E/F | Idempotent receipt, stable obligation identity, application/review status separation, CAS failure and partial outcomes. |
| Owner interventions | 10 §7; 04 §4 | C/D → E | Immediate correction before reanalysis, original/current mode, exact confirmation target, versioned assessment. |
| Policy and derivation | 01 §8 | A/C → all | Versioned settings, effective schedule, stamped default deadlines, pure derive DTO and clock fixtures. |
| Jobs and audit | 02 §15; 03 §14 | A → B/C/D/F | Dedupe/lease epoch/recovery, submit→apply atomic scheduling, immutable history and evidence retention. |
| Owner DTOs/live | 04; 05 | B/C/D → E | Stable subject keys, one Attention row/all reasons, full action list, review-only closed rows, invalidation types. |

## Minimum cross-team fixture set

- 20-second Form Lead call with clear Friday promise; full analysis and follow-up despite short duration.
- Voicemail containing a callback request; no human-contact stamp.
- Inbound human conversation on a Form Lead; clears No call yet.
- Alex owns Outreach; Jordan promises a callback; Owner separately assigns the callback to Casey.
- Call Friday + send estimate today + an undated availability check on one record.
- Owner corrects date while a prior-snapshot run is applying; Owner wins with model disagreement visible.
- Same run delivered twice and a later run repeating the same promise; one obligation, full run history.
- Old promise followed by fulfilled callback and Booking, ingested out of order; no revived overdue action.
- Contact restriction conflicts with an Owner callback; plan preserved but calling paused.
- No recording/AI budget exhausted while missed-call and Owner commands continue.

## Interface changes

Changing a field/enum/route requires updating its canonical source document, typed schema, example fixture, consumers and acceptance test in one coordinated handoff. A contract change is not complete because one repo compiles. Never retain an old acceptance-gated API behind a new label.

## Readiness checkpoints

| Gate | Evidence | Current status |
| --- | --- | --- |
| G1 Contracts frozen | Independent GPT-6 review approved; substantive findings resolved; concrete types/migrations/DTO fixtures published for B–E | Complete for foundation. [Independent review](evidence/csi-01/STEP2-INDEPENDENT-REVIEW.md). Downstream consumer integration acceptance remains part of feature delivery. |
| G2 Operational loop | Capture → attribution → clocks/actions → Owner UI without AI | Not started |
| G3 Intelligence loop | Transcript → scoped MCP reads → submit → auto-apply → intervention | Not started |
| G4 Resilience | Dedupe/races/history/budget/permission/retry/retention proofs | Not started |
| G5 Owner walkthrough | Acceptance scenarios with real UI and test backend | Not started |
| G6 Production capability/rollout | Fresh grants/subscription/credentials/model checks and separate deployment evidence | Not started |

## September 17 codebase alignment

[Audit and required adaptations](../11-codebase-alignment-audit.md) are part of this delivery contract. Complete the rows assigned to this team and provide integration evidence; current runtime helpers do not already satisfy the revised contracts. [Design intake](../07-claude-design-brief.md) governs the forthcoming Claude artifact; its arrival is not assumed.

## CSI-01 concrete imports (server-relative, September 17)

Contract version `csi-foundation-v1`; envelope `csi-envelope-v1`; run credential `csi-run-token-v1`; initial policy `csi-policy-v1`. Policy versions thereafter are unique immutable version identifiers, with a revisioned active pointer. These interfaces are frozen for B–E implementation after independent review. Exported schemas use Zod; consumer types are inferred from those schemas rather than duplicated declarations.

| Consumer | Import and exports | Obligation |
| --- | --- | --- |
| All | `src/config/domain/salesIntelligence.ts`: `CSI_CONTRACT_VERSION`, action/stage/tool/error enums, `csiFlag`, `csiDataset` | Flags default off; one deployment/database context. |
| D, C | `src/validation/intelligence/intelligenceEnvelope.validation.ts`: `intelligenceEnvelopeSchema`, `intelligenceFindingSchema`, `parseIntelligenceEnvelope`, `IntelligenceEnvelope` | Strict assertions and evidence shapes only; no authority to execute an action. Synthetic examples in adjacent `fixtures.ts`. |
| C, E | `src/validation/v1/salesIntelligence.ts`: `csiCommandSchema`, `CsiCommand`, `csiFollowupInputSchema`, `csiDateResolutionSchema`, `csiSubjectSchema`, `CsiSubject` | Closed command union; expected revisions; ISO UTC strings; nullable dates are meaningful. Handler performs semantic validation. |
| C, E | Same module: `CSI_OWNER_ACTIONS`, `csiActionAvailabilitySchema`, `csiErrorSchema`, `csiListQuerySchema`, `csiPolicySchema`, `CsiPolicy`, `csiSettingsCommandSchema` | Legal-action DTO describes availability; runtime must revalidate before mutation. |
| B–E | Same module: `csiRepInputSchema`, `csiRepCommandSchema`, `csiNudgeInputSchema`, `csiNudgeCommandSchema`, `csiBackfillCommandSchema`, `csiSubmissionReceiptSchema` | Separate strict schemas for endpoint families; these do not send messages or start backfills. |
| E with B/C/D producers | `src/services/salesIntelligence/dto.ts`: `CoverageDto`, `AssignmentDto`, `DerivedDto`, `FollowupDto`, `FindingDto`, `OutreachDto`, `ActionAvailabilityDto`, `AttentionRowDto`, `ReviewItemDto`, `RestrictionDto`, `NumberDetailDto`, `TimelineEventDto`, `EvidenceSnapshotDto`, `OwnerInstructionDto` and corresponding lower-camel `*Schema` exports | Parse outbound DTOs; all row revisions come from storage. `ownerReadSchema` wraps data with `as_of` and `coverage`; `attentionPageDtoSchema` defines snapshot pagination. `assessmentDtoSchema` is the assessment contract. |
| E | `src/services/salesIntelligence/fixtures.ts`: `undatedFollowupFixture`, `ambiguousReviewFixture`, `closedReviewFixture`, `unknownCoverageFixture` | Review-only Attention rows may have `outreach: null`; do not invent an Outreach record or known coverage. |
| B–D | `src/models/<ModelName>.ts`: `get<ModelName>Model`, named schema and index exports; `src/models/salesIntelligence/registry.ts`: `CSI_MODEL_REGISTRY` | Accessors route through `getMongoDatabaseName`; never import a global default-DB model. Index migration must precede writes. |
| B–D | `src/services/salesIntelligence/transactions.ts`: `csiCas`, `executeCsiCommand`, `appendCsiAudit`, `CsiTransactionContext`, `payloadHash` | Use callback session for aggregate, audit, and downstream enqueue. External calls must remain outside retried transactions. |
| B–D | `src/services/salesIntelligence/jobs.ts`: `enqueueCsiJob`, `claimCsiJob`, `renewCsiJob`, `completeCsiJob`, `failCsiJob`, `JobInput`, `JobLease` | Mongo is authoritative; queue messages carry wake-ups. Commit effects inside completion callback, never before it. |
| D | `src/services/salesIntelligence/auth.ts`: `requireCsiRun`, `issueCsiRunToken`, `runClaimsSchema`, `RunClaims`; `evidence.ts`: `validateEnvelopeEvidence` | Load stored run/job; construct evidence manifest from trusted persisted snapshots. No model-provided manifest or actor. Full MCP tools remain D. |
| C, D | `src/services/salesIntelligence/aiBudget.ts`: `initializeCsiBudgetPeriod`, `reserveCsiBudget`, `reconcileCsiBudget` | C computes staffed/calendar boundaries; D reserves before provider calls and reconciles actual usage, including overestimates. |
| C, E | `src/services/salesIntelligence/policy.ts`: `defaultCsiPolicy`, `resolvePolicy`, `initializeCsiPolicy`, `updateCsiPolicy` | Reads do not initialize storage. Owner initialization/update use idempotency and CAS; policy versions are append-only. |

## CSI-02 concrete imports (server-relative, September 17)

Capture contract version `csi-capture-v1`, built on `csi-foundation-v1`. Handoff: [evidence/csi-02/HANDOFF.md](evidence/csi-02/HANDOFF.md). Service card: `docs/knowledge/services/number-activity-capture.md`.

| Consumer | Import and exports | Obligation |
| --- | --- | --- |
| CSI-03 (webhook fan-out) | `src/services/numberActivity/observeWebhookEvents.ts`: `normalizeWebhookPartyObservations(payload, receivedAt)`, `observeRingCentralWebhookEvents(observations, deps)`, `SessionObservationResult` | Call from the durable capture-projection job with stored receipt evidence, not from an unawaited route hook. One result per telephony session; `ok:false` carries a bounded `error_code`, never a provider body. Account comes from party `accountId`/event path or `RINGCENTRAL_ACCOUNT_ID`; `account_unresolved` must stay visible, not defaulted. |
| CSI-03/A (cron) | `src/services/numberActivity/reconcileCallLog.ts`: `runCallLogReconcileOnce(deps?)`, `ReconcileSummary`, `CALL_LOG_ALL_DIRECTIONS_SCOPE`, `callLogReconcileConfig()` | Returns `{skipped:true, skip_reason:"disabled"|"lease_held"}` when the flag is off or the lease is held; never throws provider content. Mount at `/api/cron/sales-intelligence-call-log-reconcile` (`3-59/10 * * * *`) with `CAPTURE_CALL_LOG`; registration is not done in CSI-02. |
| CSI-04, C, D, E | `src/models/CallInteraction.ts` rows: `external_endpoint_kind`, `parties[]` (role/extension/sequence/connected/terminal), `legs[]`, `recordings[]` (all ids, `observed_at`, `lead_conversation_id` null until CSI-11), `sources[]`, `provider_last_modified_at`, `terminal`, `projection_revision`, `merged_into_id` | Follow `merged_into_id` to the canonical row before deriving. Count an interaction once; count recordings per `recordings[]` entry. `contact_type` is `unknown` unless provider voicemail, transcript or Owner set it. |
| CSI-04, E | `src/models/SalesIntelligenceSyncState.ts` scope `call_log_all_directions`: `cursor.last_sync_from/to`, `known_complete_through`, `gaps[] {from,to,reason,opened_at}`, `last_run`, `consecutive_failures` | Coverage Watermark is `known_complete_through` plus `gaps`; anything after it or inside a gap is "not yet observed", never "no call". |
| CSI-06 (outreach), CSI-05 (attachment), CSI-11 (discovery) | `sales_intelligence_jobs` stages `outreach_ensure` (subject `number:<contact_number_id>`, `input_refs=[interaction_id]`, dedupe `csi:outreach_ensure:interaction:<id>:<revision>`), `attachment_refresh` (`csi:attachment_refresh:number:<id>:1`), `recording_discovery` (`csi:recording_discovery:interaction:<id>:recording:<rid>` and `...:pending`) | Claim through `claimCsiJob`; load the current interaction by `input_refs`, never trust job payload fields. A `:pending` discovery job means "terminal, no recording id observed yet", not "no recording". |
| Tests (B/C/D) | `src/services/numberActivity/fixtures.ts`: `webhookDelivery`, `inboundQueueAnsweredDeliveries`, `outboundUnansweredDeliveries`, `internalCallDelivery`, `withheldInboundDelivery`, `callLogRecord`, `inboundConnectedCallLog`, `transferredCallLog`, `outboundMissedCallLog`, `voicemailCallLog`, `internalCallLog`, `withheldMissedCallLog`, `malformedNumberCallLog`, `sessionIdOnlyCallLog`, `syntheticDirectory` | Synthetic only; not evidence of live provider shapes beyond the fields the projection reads. |
| Pure consumers | `src/services/numberActivity/interactionProjection.ts`: `fromWebhookParties`, `fromCallLogRecord`, `mergeProjections`, `sameProjection`, `aliasesFor`, `TERMINAL_PARTY_STATUSES`, `CONNECTED_CALL_LOG_RESULTS`; `phone.ts`: `classifyEndpoint`, `toE164`, `toNationalTenDigit`; `directory.ts`: `buildDirectoryLookup`, `loadDirectoryLookup`, `EMPTY_DIRECTORY_LOOKUP` | No I/O in the projection; rebuild (CSI-04) may replay stored evidence through the same functions. |

Additive CSI-01 corrections recorded with this contract (tests in `scripts/test-csi-capture.replica.test.ts` and `src/services/numberActivity/*.test.ts`): `CallInteraction.external_endpoint_kind` (nullable enum over `CONTACT_NUMBER_KINDS`); audit `invalidation.kind` gains `"interaction"` in `src/models/salesIntelligence/infrastructure.ts` and `appendCsiAudit`. Both are optional/enum-widening; existing CSI-01 tests still pass (15/15 replica, 65/65 focused). Not changed: qualification services, `ringcentral_call_log_sync_state`, webhook route, `vercel.json`, subscriptions.

### Storage and transaction invariants

Inventory: ContactNumber, CallInteraction, CallInteractionAlias, NumberLeadAttachment, RepIdentityLink, OwnerRepNudge, OutreachRecord, OutreachFollowup, IntelligenceRun, IntelligenceEvidenceSnapshot, IntelligenceSubmission, IntelligenceFinding, IntelligenceEffect, SalesIntelligenceOwnerInstruction, IntelligenceOwnerAssessment, SalesIntelligenceReviewItem, SalesIntelligenceContactRestriction, SalesIntelligenceJob, SalesIntelligenceAuditEvent, SalesIntelligenceCommandExecution, SalesIntelligenceAiBudget, SalesIntelligenceAiReservation, SalesIntelligencePolicyVersion, SalesIntelligencePolicyPointer, SalesIntelligenceAttentionSnapshot, RingCentralDirectorySnapshot, SalesIntelligenceSyncState, SalesIntelligenceSyncWindow; existing LeadConversation is extended compatibly.

ContactNumber is global normalized E.164. Provider interaction aliases and recordings are account-scoped. Unknown recording accounts block migration apply; they are never assigned a fabricated default. LeadConversation metadata can be null, legacy summary text still renders, and structured summaries map envelope `money_and_dates/commitments/discrepancies` to public `money_dates/promised/mismatch` using `envelopeSummarySections` and `renderEnvelopeSummary`.

Multiple active follow-ups are supported. `commitment_key` is a stable server-assigned obligation identity; nullable due dates stay null. Unique commitment/missed-episode fences do not implement semantic matching. Immutable snapshots, submissions, instructions, assessments, effects, policy versions and audit history are protected through model hooks. A finalized run cannot replace its analysis/prompt/manifest. Mutable review/projection state is separate. Privileged raw collection migration/retention access is outside these application hooks.

Owner command identity is `(actor_scope, idempotency_key)`. Hash includes command plus payload. Same key/payload replays the stored response; changed payload fails. The callback owns semantic preconditions and all aggregate revisions. CAS rejects stale revisions; audit and enqueue must share its session. CSI evidence remains in the CSI command/audit collections: no new official domain-command origin or EntityChange entity is introduced.

Jobs dedupe by stable key and payload hash. Claims increment lease epoch; completion checks owner, epoch and unexpired lease **after** the effect callback, inside the transaction. Failed fencing rolls back effects. Bounded retries distinguish permission/budget pauses from failures. Reservations atomically admit `actual + reserved + estimate <= ceiling`; reconciliation/release is exactly once. Budget increases resume budget-paused jobs in the current dataset; decreases do not.

### Authentication handoff

`src/routes/sales-intelligence-boundary.routes.ts` is mounted after the existing v1 guard. Owner reads/commands require the existing signed Registry Owner identity; broad API secret alone is insufficient. Internal run routes additionally require the named scoped key and `x-vantage-intelligence-run-token`. The named key has a hard internal-route allowlist even if its configured routes are broad. The token binds run, subject, allowed tools, audience, nonce, deployment/database, lease epoch and expiry (maximum 900 seconds), checked against the stored active run and lease. A token without the scoped key is denied. Feature handlers are intentionally left to B–D; mount them after this boundary.

Configure `SALES_INTELLIGENCE_SCOPED_KEY_NAME` to match an entry in existing `VANTAGE_SCOPED_API_KEYS`; set deployment identity and a dedicated run signing secret through the deployment secret store. Never embed credentials in DTOs. Existing Gateway/Blob and optional matched Redis URL/token configuration is reused by `csiProviderConfiguration`; TEST_MODE disables optional Redis. No provider capability is claimed by these accessors.

For that named key, configure these exact stable route templates: GET `/api/v1/internal/sales-intelligence/runs/:id/context`, POST `/api/v1/internal/sales-intelligence/runs/:id/read`, POST `/api/v1/internal/sales-intelligence/runs/:id/submit`, GET `/api/v1/internal/sales-intelligence/runs/:id/submission`. Only these templates expand a 24-hex run id; generic scoped keys retain literal-path semantics, and arbitrary wildcards are not supported. Each actual request still requires its matching signed run token.

`initializeCsiBudgetPeriod` stores `activated_at` and atomically resumes budget-paused jobs once when the supplied period is current and has allowance. Precreating a future period does not wake work; retrying activation does not repeatedly resume exhausted jobs. Job dedupe is database-global: a reused key under another deployment is an explicit `IDEMPOTENCY_CONFLICT`, never a successful replay of unclaimable work.

### Minimal request and receipt examples

Synthetic undated action (idempotency key is supplied separately to the command executor by the handler):

```json
{"command":"create_followup","expected_revision":1,"outreach_record_id":"aaaaaaaaaaaaaaaaaaaaaaaa","action":{"kind":"check_availability","description":"Check crew availability","due_at":null}}
```

Strict submission receipt shape (D persists and returns it atomically with application-job enqueue):

```json
{"run_id":"aaaaaaaaaaaaaaaaaaaaaaaa","submission_id":"bbbbbbbbbbbbbbbbbbbbbbbb","application_job_id":"cccccccccccccccccccccccc","status":"submitted"}
```

Owner intervention bodies preserve exact analysis targets. Digest equality, correction ownership and source availability are runtime checks, separate from shape validation:

```json
{"command":"confirm_run","expected_revision":2,"expected_output_digest":"synthetic-output-digest"}
```

```json
{"command":"apply_suggestion","expected_revision":2,"run_id":"aaaaaaaaaaaaaaaaaaaaaaaa","suggestion_output_digest":"synthetic-suggestion-digest","due_at":null,"responsible_agent_id":"bbbbbbbbbbbbbbbbbbbbbbbb"}
```

```json
{"command":"reanalyze","expected_revision":2,"mode":"original_evidence","source_run_id":"aaaaaaaaaaaaaaaaaaaaaaaa","owner_correction_ids":["bbbbbbbbbbbbbbbbbbbbbbbb"],"reason":"Review the Owner correction against original evidence"}
```

`source_run_id` is required for original-evidence mode; current-context mode may omit it. `owner_correction_ids` is an explicit array (empty when none). Optional suggestion overrides preserve the distinction between omission and explicit null.

`FindingDto.assertion` contains the discriminated envelope finding; review state/effect status are sibling projection fields. This explicit nesting replaces the earlier illustrative flattened DTO so assertion fields cannot be confused with mutable application state. Consumers must use the executable schema.

Defaults remain $80/month, Mon–Sat 08:00–20:00 America/New_York, 30/15 staffed-minute deadlines and 1,440 staffed-minute Going cold. Clock evaluation, call reconciliation, Outreach effect rules, full MCP tools and dashboard screens are downstream work. Scenario fixtures above remain integration acceptance requirements, not claims that those services exist.
