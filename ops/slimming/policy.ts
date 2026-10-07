/**
 * Slimming deletion policy: which namespaces are dropped, which are cleaned in place, and which are never
 * touched. Both `inventory.ts` (which turns this policy plus live observation into the hashed
 * `deletion-manifest.json`) and `purge.ts` (which executes that manifest) read it.
 *
 * Authority: docs/server-admin-slimming/SPECIFICATION.md §3, §4, §6, §7.2 and DATA-AND-STORAGE.md §1.
 * Names are exact. Nothing here is a prefix, a pattern or a wildcard, and an unlisted namespace is `unknown`,
 * which is never a target.
 *
 * Observability names were resolved from `src/config/domain/observability.ts` at baseline `6a374fab`:
 * production mode selects `operational_events`, `operational_incidents`, `notification_deliveries` and
 * `operational_report_runs`; test mode the same names with a `test_` prefix; `OBSERVABILITY_COLLECTION_PREFIX`
 * and custom mode are unset in the server `.env`. The 2026-10-03 inventory found no `test_` or prefixed alias
 * in any database, so the four production names are the whole family.
 */

export const MAIN_DATABASE = "vantagemovers";
export const HISTORICAL_DATABASE = "vantagemovershistorical";
/** Resolved from the Admin `.env` `ADMIN_AUTH_DB_NAME`; purge asserts the env still agrees. */
export const ADMIN_AUTH_DATABASE = "vantageadmin";
/** Never a database-drop target, whatever a manifest says. */
export const FORBIDDEN_DATABASE_DROPS = [MAIN_DATABASE, ADMIN_AUTH_DATABASE, "admin", "local", "config"] as const;

export type Decision = "keep" | "drop" | "migrate" | "unknown";
export type Classification = { decision: Decision; owner: string; reason: string };

const keep = (owner: string, reason: string): Classification => ({ decision: "keep", owner, reason });
const migrate = (owner: string, reason: string): Classification => ({ decision: "migrate", owner, reason });
const drop = (owner: string, reason: string): Classification => ({ decision: "drop", owner, reason });

const OFFICIAL = "Official record / Registry linkage (SPEC §1, DATA §1.2)";
const LIFECYCLE = "Granot lifecycle evidence, Health, intakes, timeline (SPEC §5, DATA §1.2)";
const RINGCENTRAL = "RingCentral Call Lead ingest/capture state (DATA §1.2)";
const REPORTING = "Retained Reporting (SPEC §2, DATA §1.2)";
const SHEET_SYNC = "Retained Sheet Sync durable state (DATA §1.2)";

/** Drop targets in the selected main runtime database, with the spec section that authorizes each. */
export const MAIN_DROP_COLLECTIONS: Record<string, { spec: string; owner: string; gate: string }> = {
  operational_events: { spec: "§4", owner: "src/models/OperationalEvent.ts", gate: "SLIM-04: Health replaced, every OperationalEvents writer removed and deployed" },
  operational_incidents: { spec: "§4", owner: "src/models/OperationalIncident.ts", gate: "SLIM-04" },
  notification_deliveries: { spec: "§4", owner: "src/models/NotificationDelivery.ts", gate: "SLIM-04: digest cron and notification writers removed" },
  operational_report_runs: { spec: "§4", owner: "src/models/OperationalReportRun.ts", gate: "SLIM-04" },
  lead_conversations: { spec: "§7.2", owner: "src/models/LeadConversation.ts", gate: "SLIM-06: no transcript/media/STT reader or worker; Blob keys manifested" },
  intelligence_runs: { spec: "§7.2", owner: "src/models/salesIntelligence/intelligence.ts", gate: "SLIM-06: run tokens/submissions fenced" },
  intelligence_evidence_snapshots: { spec: "§7.2", owner: "src/models/salesIntelligence/intelligence.ts", gate: "SLIM-06" },
  intelligence_submissions: { spec: "§7.2", owner: "src/models/salesIntelligence/intelligence.ts", gate: "SLIM-06" },
  intelligence_findings: { spec: "§7.2", owner: "src/models/salesIntelligence/intelligence.ts", gate: "SLIM-06 + HUMAN-FACTS restriction facts preserved" },
  intelligence_effects: { spec: "§7.2", owner: "src/models/salesIntelligence/intelligence.ts", gate: "SLIM-06" },
  intelligence_owner_assessments: { spec: "§7.2", owner: "src/models/salesIntelligence/intelligence.ts", gate: "SLIM-06" },
  move_assessment_artifacts: { spec: "§7.2", owner: "src/models/salesIntelligence/assessment.ts", gate: "SLIM-06: assessment producers removed" },
  sales_intelligence_ai_budget: { spec: "§7.2", owner: "src/models/salesIntelligence/infrastructure.ts", gate: "SLIM-06: in-flight reservations settled" },
  sales_intelligence_ai_reservations: { spec: "§7.2", owner: "src/models/salesIntelligence/infrastructure.ts", gate: "SLIM-06" },
  sales_intelligence_attention_snapshots: { spec: "§7.2", owner: "src/models/salesIntelligence/infrastructure.ts", gate: "SLIM-07: Attention publishers/readers retired" },
  sales_intelligence_attention_artifacts: { spec: "§7.2", owner: "src/models/salesIntelligence/attentionArtifact.ts", gate: "SLIM-07" },
  outreach_records: { spec: "§7.2", owner: "src/models/salesIntelligence/outreach.ts", gate: "SLIM-07: legacy planner removed, Numbers independent, HUMAN-FACTS disposition done" },
  outreach_followups: { spec: "§7.2", owner: "src/models/salesIntelligence/outreach.ts", gate: "SLIM-07 + HUMAN-FACTS: exported to the pre-purge backup, never replayed" },
  outreach_band_transitions: { spec: "§7.2", owner: "src/models/salesIntelligence/outreach.ts", gate: "SLIM-07" },
  outreach_rep_days: { spec: "§7.2", owner: "src/models/salesIntelligence/overview.ts", gate: "SLIM-07" },
};

/** Drop targets in the Admin auth database. */
export const ADMIN_DROP_COLLECTIONS: Record<string, { spec: string; owner: string; gate: string }> = {
  admin_audit_logs: { spec: "§6", owner: "vantage-admin server/models/AdminAuditLog.ts", gate: "SLIM-08: Admin page/API/auth/proxy writers removed and deployed" },
};

/**
 * Collections in the main DB that no purge step may drop. Cleanups may touch the `migrate` ones only.
 * The slimming purge ran to completion on 2026-10-04. The disk trim (DISK-TRIM.md, `ops/disk-trim/trim.ts`,
 * 2026-10-07) later dropped `sales_intelligence_owner_instructions`, `sales_intelligence_sync_windows` and
 * `sales_intelligence_review_items`; they stay listed here only so the checked-in manifest, its hash and
 * `manifestPolicyDrift` keep describing the purge as it ran.
 */
export const NEVER_DROP = [
  "granot_webhook_receipts",
  "entity_changes",
  "daily_operations_events",
  "daily_operations_days",
  "sales_intelligence_jobs",
  "sales_intelligence_sync_state",
  "sales_intelligence_sync_windows",
  "sales_intelligence_audit_events",
  "sales_intelligence_command_executions",
  "sales_intelligence_policy_versions",
  "sales_intelligence_policy_pointers",
  "sales_intelligence_contact_restrictions",
  "sales_intelligence_owner_instructions",
  "sales_intelligence_review_items",
  "owner_rep_nudges",
  "contact_numbers",
  "call_interactions",
  "call_interaction_aliases",
  "number_lead_attachments",
  "rep_identity_links",
  "ringcentral_directory_snapshots",
  "reporting_definitions",
  "reporting_definition_revisions",
  "reporting_deliveries",
  "reporting_destinations",
  "reporting_previews",
  "reporting_run_confirmations",
  "reporting_run_manifests",
  "reporting_runs",
  "customers",
  "agents",
  "form_leads",
  "call_leads",
  "booked_leads",
  "cancelled_leads",
  "granot_observations",
  "synchronization_decisions",
  "granot_record_links",
  "granot_lifecycle_activations",
  "domain_command_executions",
  "operations_registry_changes",
] as const;

/** Collections in the Admin auth DB that must survive. */
export const ADMIN_NEVER_DROP = ["admin_users", "admin_user_invites"] as const;

/** Every main-DB collection observed on 2026-10-03, classified. Anything absent from this map is `unknown`. */
export const MAIN_CLASSIFICATION: Record<string, Classification> = {
  ...Object.fromEntries(Object.entries(MAIN_DROP_COLLECTIONS).map(([name, t]) => [name, drop(t.owner, `SPEC ${t.spec} exclusive target`)])),
  agents: keep("src/models/Agent.ts", "Registry, allocation, receiver attribution, extension catalog (SPEC §2)"),
  customers: keep("src/models/Customer.ts", "Booking linkage and Customer upserts (SPEC §2)"),
  form_leads: keep("src/models/FormLead.ts", OFFICIAL),
  call_leads: keep("src/models/CallLead.ts", OFFICIAL),
  booked_leads: keep("src/models/BookedLead.ts", OFFICIAL),
  cancelled_leads: keep("src/models/CancelledLead.ts", OFFICIAL),
  testimonials: keep("src/models/Testimonial.ts", "Testimonials destination (SPEC §2)"),
  merchants: keep("Registry", OFFICIAL),
  moving_carriers: keep("Registry", OFFICIAL),
  lead_source_companies: keep("Registry", "Source attribution (DATA §1.2)"),
  lead_source_granularities: keep("Registry", "Source attribution (DATA §1.2)"),
  lead_source_label_mappings: keep("Registry", "Source attribution (DATA §1.2)"),
  cpl_rates: keep("CPL", "Pricing (DATA §1.2)"),
  cpl_rate_periods: keep("CPL", "Pricing (DATA §1.2)"),
  cpl_correction_jobs: keep("CPL", "Pricing (DATA §1.2)"),
  operations_registry_changes: keep("Registry", "Registry history (SPEC §6)"),
  entity_changes: keep("src/models/EntityChange.ts", "Job Timeline + attachment wakeups (SPEC §6)"),
  domain_command_executions: keep("domain commands", "Command replay (SPEC §6)"),
  daily_operations_events: keep("Daily Operations", "Protected byte-for-byte (SPEC §4.1)"),
  daily_operations_days: keep("Daily Operations", "Protected byte-for-byte (SPEC §4.1)"),
  granot_webhook_receipts: keep("src/models/GranotObservationReceipt.ts", "Observation Receipts, channel-neutral (SPEC §5)"),
  granot_observations: keep("src/models/GranotObservation.ts", LIFECYCLE),
  synchronization_decisions: keep("Synchronization Decisions", LIFECYCLE),
  granot_record_links: keep("src/models/GranotRecordLink.ts", LIFECYCLE),
  granot_booking_reconciliation_cases: keep("src/models/GranotBookingReconciliationCase.ts", LIFECYCLE),
  granot_release_reconciliation_cases: keep("src/models/GranotReleaseReconciliationCase.ts", LIFECYCLE),
  granot_booking_discrepancies: keep("src/models/GranotBookingDiscrepancy.ts", LIFECYCLE),
  granot_release_discrepancies: keep("src/models/GranotReleaseDiscrepancy.ts", LIFECYCLE),
  granot_lifecycle_activations: keep("src/models/GranotLifecycleActivation.ts", "Activation provenance (SPEC §4.1)"),
  granot_crm_sources: keep("src/models/GranotCrmSource.ts", "Granot CRM sources (DATA §1.2)"),
  granot_crm_sync_runs: keep("src/models/GranotCrmSyncRun.ts", "Ingestion state (DATA §1.2)"),
  granot_crm_csv_ingestions: keep("src/models/GranotCrmCsvIngestion.ts", "Granot CSV state (DATA §1.2)"),
  granot_automation_sources: keep("Granot HTTP Automation", "Ingestion (SPEC §2)"),
  granot_automation_runs: keep("Granot HTTP Automation", "Ingestion (SPEC §2)"),
  booking_lead_reconciliation_cases: keep("Booking reconciliation", "Booking reconciliation (DATA §1.2)"),
  ingestion_runs: keep("Ingestion", "Ingestion runs (DATA §1.2)"),
  ingestion_conflicts: keep("Ingestion", "Ingestion conflicts (DATA §1.2)"),
  source_row_receipts: keep("Best Relocation ingestion", "Ingress fencing (SPEC §2)"),
  source_row_states: keep("Best Relocation ingestion", "Ingress fencing (SPEC §2)"),
  wordpress_form_submission_receipts: keep("src/models/WordpressFormSubmissionReceipt.ts", "WordPress ingress + Job Timeline"),
  public_submission_throttle_buckets: keep("WordPress throttle", "Ingress throttle (DATA §1.2)"),
  lead_messages: keep("src/models/LeadMessage.ts", "Lead Message delivery (DATA §1.2)"),
  lead_message_rate_limits: keep("Lead messaging", "Lead Message rate limit (DATA §1.2)"),
  extension_users: keep("Extension", "Extension auth (SPEC §2)"),
  integration_tokens: keep("Integrations", "Provider credentials (DATA §1.2)"),
  external_data_connections: keep("Reporting", REPORTING),
  google_drive_connections: keep("Reporting", REPORTING),
  google_oauth_states: keep("Reporting", REPORTING),
  google_picker_nonces: keep("Reporting", REPORTING),
  google_picker_selections: keep("Reporting", REPORTING),
  reporting_definitions: keep("Reporting", REPORTING),
  reporting_definition_revisions: keep("Reporting", REPORTING),
  reporting_deliveries: keep("Reporting", REPORTING),
  reporting_destinations: keep("Reporting", REPORTING),
  reporting_previews: keep("Reporting", REPORTING),
  reporting_run_confirmations: keep("Reporting", REPORTING),
  reporting_run_manifests: keep("Reporting", REPORTING),
  reporting_runs: keep("Reporting", REPORTING),
  sheet_sync_attempts: keep("Sheet Sync", SHEET_SYNC),
  sheet_sync_jobs: keep("Sheet Sync", SHEET_SYNC),
  sheet_sync_leases: keep("Sheet Sync", SHEET_SYNC),
  sheet_sync_quota_buckets: keep("Sheet Sync", SHEET_SYNC),
  sheet_sync_runs: keep("Sheet Sync", SHEET_SYNC),
  ringcentral_webhook_events: keep("src/services/ringcentral/ringcentral-config.ts", RINGCENTRAL),
  ringcentral_webhook_events_test: keep("ringcentral-config `_test` runtime alias", RINGCENTRAL),
  ringcentral_call_candidates_test: keep("ringcentral-config `_test` runtime alias", RINGCENTRAL),
  ringcentral_call_candidate_decisions_test: keep("ringcentral-config `_test` runtime alias", RINGCENTRAL),
  ringcentral_call_sessions: keep("ringcentral-config", RINGCENTRAL),
  ringcentral_processed_calls: keep("ringcentral-config", RINGCENTRAL),
  ringcentral_convergence_locks: keep("ringcentral-config", RINGCENTRAL),
  ringcentral_call_log_sync_state: keep("ringcentral-config", RINGCENTRAL),
  ringcentral_analytics_snapshots: keep("ringcentral-config", RINGCENTRAL),
  ringcentral_webhook_subscriptions: keep("RingCentral subscriptions", RINGCENTRAL),
  ringcentral_rate_limit_gates: keep("RingCentral rate gate", RINGCENTRAL),
  ringcentral_inbound_routes: keep("Inbound routes", "Inbound-source assignments (SPEC §7.3)"),
  ringcentral_inbound_route_assignments: keep("Inbound routes", "Inbound-source assignments (SPEC §7.3)"),
  ringcentral_directory_snapshots: keep("Directory", "RingCentral Accounts (SPEC §7.3)"),
  rep_identity_links: keep("Rep identity", "Reviewed Rep identity (SPEC §7.3)"),
  call_interactions: keep("Number activity", "Canonical provider call metadata (SPEC §7.3)"),
  call_interaction_aliases: keep("Number activity", "Canonical call aliases (SPEC §7.3)"),
  number_lead_attachments: keep("src/models/NumberLeadAttachment.ts", "Reviewed Number↔Lead attachments (SPEC §7.3)"),
  sales_intelligence_coverage_projections: keep("src/services/numberActivity/coverage.ts", "Numbers coverage/freshness"),
  sales_intelligence_sync_windows: keep("CSI capture", "Capture completeness windows (SPEC §7.3)"),
  sales_intelligence_policy_pointers: keep("CSI policy", "Active policy pointer (SPEC §7.3)"),
  contact_numbers: migrate("src/models/ContactNumber.ts", "Kept; dead summary/schedule/AI/outreach fields are unset (SPEC §7.4, DATA §1.3)"),
  sales_intelligence_jobs: migrate("src/models/salesIntelligence/infrastructure.ts", "Mixed; legacy-stage rows terminalized then deleted (SPEC §7.3, DATA §1.3)"),
  sales_intelligence_sync_state: migrate("src/models/salesIntelligence/capture.ts", "Mixed; exact Attention fence rows deleted (CODE-MAP §7.1)"),
  sales_intelligence_audit_events: migrate("src/models/salesIntelligence/infrastructure.ts", "Mixed append-only audit; retired-feature kinds proposed for deletion (SPEC §6, §7.3)"),
  sales_intelligence_command_executions: migrate("src/models/salesIntelligence/infrastructure.ts", "Mixed command replay; retired commands proposed for deletion"),
  sales_intelligence_policy_versions: migrate("src/models/salesIntelligence/infrastructure.ts", "Kept: the active version and versions referenced by kept jobs/commands"),
  sales_intelligence_review_items: migrate("src/models/salesIntelligence/intelligence.ts", "Kept minimal human facts (HUMAN-FACTS.md)"),
  sales_intelligence_owner_instructions: migrate("src/models/salesIntelligence/intelligence.ts", "Kept minimal human facts (HUMAN-FACTS.md)"),
  sales_intelligence_contact_restrictions: migrate("src/models/salesIntelligence/intelligence.ts", "Kept restriction authority (HUMAN-FACTS.md)"),
  owner_rep_nudges: migrate("src/models/OwnerRepNudge.ts", "Kept: Accounts review_context sends and delivery uncertainty (SPEC §7.3)"),
};

/**
 * Legacy job stages SPEC §7.4 removes outright: exactly the server's `CSI_RETIRED_JOB_STAGES`
 * (`src/config/domain/salesIntelligence.ts`; a unit test pins the equality). Rows of these stages are
 * terminalized (pending/retry/paused, and leased rows whose lease has expired) and then deleted, together with
 * the rows the slim server's fence already marked `retired`. A live lease aborts the purge: an old worker is
 * still running. Wave 2 settled the former split stages: `number_refresh`, `backfill` and `retention` are
 * retired (retention runs in the cron, not as a job), and `rebuild` is retained whole.
 */
export const LEGACY_JOB_STAGES = [
  "outreach_ensure",
  "outreach_derive",
  "recording_discovery",
  "media",
  "media_fetch",
  "transcription",
  "analysis",
  "application",
  "number_refresh",
  "backfill",
  "retention",
  "rep_identity_reevaluate",
  "move_assessment",
] as const;
/** No job stage is split any more (see `LEGACY_JOB_STAGES`); kept so the inventory report shape is stable. */
export const SPLIT_JOB_STAGES: readonly string[] = [];
export const RETIRED_JOB_REASON = "slimming_retired_stage";

/** ContactNumber paths the slim schema drops (SPEC §7.4). Final after the S-NUM/S-AI/S-OUT schema cut (wave 2). */
export const CONTACT_NUMBER_DEAD_FIELDS = [
  "running_summary",
  "intelligence_schedule",
  "rollups.open_outreach_count",
  "rollups.conversations_analyzed_total",
  "rollups.last_analyzed_at",
  "rollups.outreach_records_total",
  "rollups.last_meaningful_contact_at",
] as const;
/**
 * Content-retention bookkeeping that only served conversation content purges; no retained reader (wave 2).
 * `purged_at` is NOT here: the retained Call-activity retention writes it as the purge marker, and Numbers
 * search, timeline and history reads filter on it, so unsetting it would resurface purged Numbers.
 */
export const CONTACT_NUMBER_REVIEW_FIELDS = ["content_purge_pending", "retention_epoch", "evidence_fence"] as const;

/**
 * CallInteraction pointers into the dropped `lead_conversations` (C7). The slim schema (`src/models/CallInteraction.ts`)
 * no longer declares `recordings[].lead_conversation_id` or the `recording_discovery` sub-document, and no retained
 * reader or writer names either (S-AI → CallInteraction trim, INTEGRATION-SERVER.md). `recordings.$[]...` is an
 * all-elements `$unset`: every other recording field (`provider_recording_id`, `recording_type`, `observed_at`) stays.
 * The stale `call_interaction_discovery_state` index is not touched here (the purge guard never sends `dropIndexes`).
 */
export const CALL_INTERACTION_DEAD_PATHS = ["recording_discovery", "recordings.$[].lead_conversation_id"] as const;

/**
 * `sales_intelligence_sync_state` scopes, exact. Owners: `outreach/worker.ts` (ensure, entity-change cursor,
 * repair watermarks, `attention_publish`), `outreach/bandTransitions.ts` (`attention_publish_fence:*`),
 * `outreach/attentionArtifactStore.ts` (`attention_artifacts:*`), `analysis/scheduling.ts`
 * (`intelligence_source_scan`), `overview/repDays.ts` (`overview_refresh`).
 */
export const RETIRED_SYNC_SCOPES = [
  "attention_artifacts:csi-production:vantagemovers",
  "attention_publish",
  "attention_publish_fence:csi-production:vantagemovers",
  "intelligence_source_scan",
  "overview_refresh",
  "outreach_repair:OutreachRecord",
  // Wave 2: the retired Call Log backfill's lease and cursor (no retained reader).
  "backfill",
  "backfill:call_log",
] as const;
/**
 * Outreach-owned cursors. Wave 2 confirmed no retained reader (the attachment path keeps its own
 * `attachment_watermark:*` scopes), so C6 is final.
 */
export const PENDING_SYNC_SCOPES = [
  "outreach_ensure",
  "outreach_entity_changes",
  "outreach_repair:FormLead",
  "outreach_repair:CallLead",
  "outreach_repair:CallInteraction",
] as const;
/** Scopes kept as retained capture/attachment/identity/deployment state. `rep_identity:<hash>` rows are kept too. */
export const KEPT_SYNC_SCOPES = [
  "deployment",
  "directory",
  "webhook_receipts",
  "call_log_all_directions",
  "call_log_sweep",
  "attachment_suggest",
  "attachment_watermark:FormLead",
  "attachment_watermark:CallLead",
  "attachment_watermark:ContactNumber",
  "retention",
] as const;
export const KEPT_SYNC_SCOPE_FAMILY = "rep_identity:";

/**
 * Audit `event_kind`s written only by retired AI/media/outreach/assessment/follow-up producers (observed
 * 2026-10-03). C4 deletes them for `worker`/`intelligence` actors only; Owner/Rep-actor rows (reanalysis
 * requests, media plays, outreach assign/start/end call) stay as minimal human history.
 */
export const RETIRED_AUDIT_EVENT_KINDS = [
  "analysis.reanalysis_requested",
  "analysis.suggestion_applied",
  "assessment_followup_created",
  "attachment_identity_changed",
  "call_fulfilled_action",
  "clock_boundary",
  "closure_cancelled_action",
  "conversation.failed",
  "conversation.media_skipped",
  "conversation.media_stored",
  "conversation.transcribed",
  "conversation.unavailable",
  "followup_receiver_inherited",
  "followup_superseded_by_plan",
  "identity_blocked",
  "identity_resolved",
  "intelligence.published",
  "intelligence.submitted",
  "intelligence_effect",
  "intelligence_followup_created",
  "lead_progress_updated",
  "media_played",
  "missed_call_episode",
  "move_assessment_engagement",
  "move_assessment_published",
  "number_review_opened",
  "outreach_call_applied",
  "outreach_closed",
  "outreach_contact_facts",
  "outreach_created",
  "outreach_interaction",
  "outreach_lead_attachment_mirrored",
  "outreach_number_linked",
  "outreach_receiver_assigned",
  "progress_default_created",
  "recording_discovery.completed",
  "recording_discovery.no_recording",
  "rep_identity.reevaluated",
  "wait_expired",
] as const;
export const RETIRED_AUDIT_ACTOR_KINDS = ["worker", "intelligence"] as const;

/**
 * Cleanup readiness. `purge.ts --apply` refuses while any entry is `pending_wave3`; the coordinator flips an
 * entry to `final` (or removes it) once the owning lane's schema cut is merged, then regenerates the manifest.
 */
export const CLEANUP_STATUS = {
  "C1-contact-numbers-dead-fields": "final",
  "C2-legacy-stage-jobs": "final",
  "C3-retired-sync-scopes": "final",
  "C4-retired-audit-events": "final",
  "C5-contact-numbers-retention-fields": "final",
  "C6-outreach-cursor-sync-scopes": "final",
  "C7-call-interactions-conversation-pointers": "final",
} as const satisfies Record<string, "final" | "pending_wave3">;

/**
 * The exact scope of every cleanup, keyed by id. `inventory.ts` builds the manifest cleanups from this table and
 * `manifestPolicyDrift` (lib/purge-rules.ts) refuses a manifest whose cleanup differs from it in kind, collection,
 * fields, stages, key field, key values (a manifest may list fewer scopes than the policy, never another one) or filter.
 * Every id here must appear in the manifest: a manifest generated before a cleanup was added is stale.
 */
export type CleanupScope =
  | { kind: "unset_fields"; collection: string; fields: readonly string[] }
  | { kind: "retire_jobs"; collection: "sales_intelligence_jobs"; stages: readonly string[]; reason: string }
  | { kind: "delete_exact"; collection: string; key_field: string; key_values: readonly string[] }
  | { kind: "delete_filter"; collection: string; filter: Record<string, unknown> };
export const CLEANUP_SCOPES = {
  "C1-contact-numbers-dead-fields": { kind: "unset_fields", collection: "contact_numbers", fields: CONTACT_NUMBER_DEAD_FIELDS },
  "C2-legacy-stage-jobs": { kind: "retire_jobs", collection: "sales_intelligence_jobs", stages: LEGACY_JOB_STAGES, reason: RETIRED_JOB_REASON },
  "C3-retired-sync-scopes": { kind: "delete_exact", collection: "sales_intelligence_sync_state", key_field: "scope", key_values: RETIRED_SYNC_SCOPES },
  "C4-retired-audit-events": {
    kind: "delete_filter",
    collection: "sales_intelligence_audit_events",
    filter: { event_kind: { $in: [...RETIRED_AUDIT_EVENT_KINDS] }, "actor.kind": { $in: [...RETIRED_AUDIT_ACTOR_KINDS] } },
  },
  "C5-contact-numbers-retention-fields": { kind: "unset_fields", collection: "contact_numbers", fields: CONTACT_NUMBER_REVIEW_FIELDS },
  "C6-outreach-cursor-sync-scopes": { kind: "delete_exact", collection: "sales_intelligence_sync_state", key_field: "scope", key_values: PENDING_SYNC_SCOPES },
  "C7-call-interactions-conversation-pointers": { kind: "unset_fields", collection: "call_interactions", fields: CALL_INTERACTION_DEAD_PATHS },
} as const satisfies Record<keyof typeof CLEANUP_STATUS, CleanupScope>;

/** Blob prefix written only by conversation media (`src/config/domain/conversations.ts`). */
export const CONVERSATION_BLOB_PREFIX = "conversations/";
