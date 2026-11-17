# Live collection configuration register

Read-only inventory at 2026-11-17T01:13:38.244Z (November 16, New York). Allocation is compressed collection + indexes, not logical BSON or guaranteed reclaim. All 127 collections and 610 indexes are recorded in [inventory.json](evidence/inventory.json). Proposed policies below are recommendations, not applied configuration. Four validators belong to Operations pricing; the shared database is not exclusively main-server-owned.

| Collection | Documents | Allocated MB | Index MB | Live TTL field / seconds | Proposed treatment |
|---|---:|---:|---:|---|---|
| `granot_webhook_receipts` | 1,851,649 | 1483.74 | 368.54 | retention_purge_at / 0 | Certified hot/cold retention; retain protected chains |
| `granot_observations` | 1,851,641 | 781.41 | 264.36 | retention_purge_at / 0 | Certified hot/cold retention; preserve winner and references |
| `granot_automation_runs` | 16,708 | 671.80 | 9.04 | purge_at / 0 | Existing 7-day purge date; fix bulky checkpoint writes and terminal closure |
| `sales_intelligence_jobs` | 1,475,643 | 554.66 | 227.37 | completed_at / 1209600 | 14-day current TTL; proposed 3-day proven terminal classes; preserve admissions |
| `synchronization_decisions` | 1,860,659 | 475.89 | 199.47 | retention_purge_at / 0 | Immutable decisions; expire only certified entire chains |
| `sales_intelligence_audit_events` | 23,403 | 208.67 | 73.63 | happened_at / 7776000 | Keep audit TTL; reclaim already-free pages after measurement |
| `daily_operations_events` | 510,956 | 166.11 | 99.34 | createdAt / 34560000 | 400-day current TTL; remove false upstream events, preserve reconstruction |
| `ringcentral_webhook_events` | 35,962 | 68.98 | 6.73 | receivedAt / 604800 | 7-day TTL; retain qualification and replay boundary |
| `entity_changes` | 177,373 | 63.04 | 27.94 | none | Preserve immutable business history; stop provenance-only churn |
| `domain_command_executions` | 167,128 | 62.18 | 14.34 | none | Preserve command idempotency/history; separate payload from key before expiry |
| `sheet_sync_attempts` | 457,136 | 51.29 | 32.19 | createdAt / 7776000 | 90-day current TTL; shorten only with retained terminal history |
| `call_interactions` | 35,393 | 32.88 | 10.92 | none | Policy-driven redaction; retain identity tombstones; lift retention throughput |
| `sheet_sync_jobs` | 163,408 | 28.66 | 13.23 | none | Add terminal-evidence contract first; preserve active/uncertain jobs |
| `form_leads` | 8,877 | 16.50 | 7.55 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `sales_outreach_contact_events` | 47,844 | 14.07 | 5.16 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `call_interaction_aliases` | 106,189 | 12.89 | 5.53 | none | Preserve dedupe/tombstone identity |
| `sheet_sync_runs` | 107,523 | 12.52 | 6.99 | started_at / 7776000 | 90-day current TTL; avoid empty-run persistence where safe |
| `sales_outreach_projections` | 3,676 | 9.44 | 2.58 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `contact_numbers` | 10,995 | 7.73 | 3.80 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `ingestion_runs` | 61 | 7.31 | 0.32 | none | Preserve approved final reconciliation evidence; retired ingestion stays retired |
| `sales_outreach_sms_requirement_days` | 8,646 | 5.97 | 2.51 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `sales_outreach_pool_duties` | 25,421 | 4.79 | 2.74 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `ringcentral_rep_sms_evidence` | 12,451 | 4.26 | 1.90 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `call_leads` | 2,097 | 4.16 | 2.34 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `lead_messages` | 5,340 | 4.08 | 2.36 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `granot_record_links` | 12,279 | 2.85 | 1.16 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `granot_history_archive_chunks` | 6,229 | 2.82 | 1.27 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `sales_outreach_sms_volume_contributions` | 12,451 | 2.78 | 0.97 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `sales_outreach_live_events` | 26,331 | 2.61 | 1.36 | createdAt / 86400 | Keep existing TTL; verify recovery/reporting contract before shortening |
| `sales_outreach_subjects` | 3,676 | 2.29 | 0.95 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `sales_outreach_policy_periods` | 6,792 | 1.88 | 1.05 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `source_row_receipts` | 1,185 | 1.19 | 0.70 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `booked_leads` | 1,063 | 0.98 | 0.69 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `source_row_states` | 1,175 | 0.96 | 0.23 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `ringcentral_processed_calls` | 1,773 | 0.83 | 0.41 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `granot_booking_reconciliation_cases` | 638 | 0.72 | 0.36 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `granot_case_observations` | 893 | 0.63 | 0.09 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `sales_intelligence_command_executions` | 894 | 0.56 | 0.18 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `testimonials` | 339 | 0.51 | 0.22 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `sales_outreach_pool_work` | 985 | 0.48 | 0.25 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `pool_test_quarantine` | 522 | 0.48 | 0.05 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `sheet_sync_leases` | 6 | 0.44 | 0.40 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `granot_closed_automation_runs` | 1,765 | 0.43 | 0.14 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `granot_case_statements` | 893 | 0.42 | 0.09 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `customers` | 884 | 0.41 | 0.25 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `granot_case_decisions` | 893 | 0.39 | 0.09 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `daily_operations_read_views` | 31 | 0.39 | 0.04 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `historical_backfill_checkpoints` | 1,174 | 0.38 | 0.17 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `operations_registry_changes` | 79 | 0.36 | 0.29 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `sales_outreach_rep_day_projections` | 490 | 0.33 | 0.14 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `granot_crm_sources` | 12 | 0.28 | 0.24 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `owner_rep_nudges` | 13 | 0.27 | 0.22 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `cancelled_leads` | 51 | 0.27 | 0.22 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `daily_operations_days` | 151 | 0.26 | 0.11 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `reporting_runs` | 4 | 0.26 | 0.21 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `granot_estimates_schedule_slots` | 294 | 0.25 | 0.08 | purge_at / 0 | Keep existing TTL; verify recovery/reporting contract before shortening |
| `ringcentral_convergence_locks` | 656 | 0.25 | 0.11 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `granot_crm_csv_ingestions` | 4 | 0.24 | 0.20 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `sales_outreach_enrollment_runs` | 10 | 0.23 | 0.15 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `moving_carriers` | 24 | 0.22 | 0.18 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `lead_source_granularities` | 14 | 0.22 | 0.18 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `ringcentral_inbound_route_assignments` | 5 | 0.22 | 0.18 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `ingestion_conflicts` | 165 | 0.21 | 0.15 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `ringcentral_inbound_routes` | 5 | 0.20 | 0.17 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `ringcentral_analytics_snapshots` | 166 | 0.20 | 0.04 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `lead_source_companies` | 7 | 0.20 | 0.16 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `agents` | 20 | 0.19 | 0.15 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `rep_identity_links` | 13 | 0.18 | 0.15 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `moving_pricing_changes` | 3 | 0.18 | 0.15 | none | Operations-server owned; unchanged |
| `ringcentral_webhook_subscriptions` | 3 | 0.18 | 0.15 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `cpl_rate_periods` | 15 | 0.18 | 0.15 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `granot_crm_sync_runs` | 8 | 0.18 | 0.14 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `reporting_deliveries` | 4 | 0.18 | 0.14 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `granot_automation_sources` | 9 | 0.18 | 0.14 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `sales_outreach_configuration` | 37 | 0.17 | 0.07 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `external_data_connections` | 1 | 0.17 | 0.13 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `granot_release_reconciliation_cases` | 6 | 0.16 | 0.13 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `ringcentral_directory_snapshots` | 2 | 0.16 | 0.11 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `moving_pricing_drafts` | 7 | 0.15 | 0.11 | none | Operations-server owned; unchanged |
| `granot_release_discrepancies` | 12 | 0.15 | 0.11 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `moving_pricing_revisions` | 2 | 0.15 | 0.11 | none | Operations-server owned; unchanged |
| `granot_booking_discrepancies` | 6 | 0.15 | 0.11 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `extension_users` | 13 | 0.15 | 0.11 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `sales_outreach_followup_schedules` | 1 | 0.15 | 0.11 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `sheet_sync_quota_buckets` | 52 | 0.15 | 0.11 | window_start / 3600 | Keep existing TTL; verify recovery/reporting contract before shortening |
| `reporting_definition_revisions` | 7 | 0.14 | 0.10 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `integration_tokens` | 1 | 0.13 | 0.09 | refresh_token_expires_at_date / 0 | Keep existing TTL; verify recovery/reporting contract before shortening |
| `sales_intelligence_sync_state` | 59 | 0.13 | 0.07 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `capacity_snapshots` | 41 | 0.12 | 0.07 | none | Keep daily history; correct forecasts |
| `reporting_destinations` | 2 | 0.11 | 0.08 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `cpl_rates` | 13 | 0.11 | 0.08 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `granot_lifecycle_health_state` | 7 | 0.11 | 0.08 | expires_at / 0 | Keep existing TTL; verify recovery/reporting contract before shortening |
| `merchants` | 7 | 0.11 | 0.08 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `reporting_definitions` | 7 | 0.11 | 0.08 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `sales_intelligence_policy_versions` | 4 | 0.11 | 0.07 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `sales_outreach_performance_state` | 1 | 0.11 | 0.07 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `systems_locations` | 1 | 0.11 | 0.07 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `sales_intelligence_contact_restrictions` | 16 | 0.11 | 0.07 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `form_fill_work` | 0 | 0.11 | 0.07 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `sales_outreach_performance_policies` | 1 | 0.11 | 0.07 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `historical_backfill_runs` | 2 | 0.09 | 0.06 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `sales_intelligence_coverage_projections` | 1 | 0.09 | 0.06 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `google_drive_connections` | 1 | 0.09 | 0.06 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `granot_lifecycle_activations` | 1 | 0.09 | 0.06 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `ringcentral_call_log_sync_state` | 1 | 0.09 | 0.06 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `sales_intelligence_policy_pointers` | 1 | 0.09 | 0.06 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `granot_estimates_open_dates` | 347 | 0.09 | 0.05 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `data_migration_runs` | 1 | 0.09 | 0.04 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `granot_retention_control` | 1 | 0.07 | 0.04 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `granot_retention_days` | 8 | 0.07 | 0.04 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `granot_backfill_deliveries` | 12 | 0.07 | 0.04 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `moving_pricing_control` | 1 | 0.07 | 0.04 | none | Operations-server owned; unchanged |
| `ringcentral_rate_limit_gates` | 3 | 0.07 | 0.04 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `lead_message_rate_limits` | 2 | 0.07 | 0.05 | expires_at / 0 | Keep existing TTL; verify recovery/reporting contract before shortening |
| `booking_lead_reconciliation_cases` | 0 | 0.07 | 0.06 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `cpl_correction_jobs` | 0 | 0.03 | 0.03 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `ringcentral_call_sessions` | 0 | 0.02 | 0.02 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `lead_source_label_mappings` | 0 | 0.02 | 0.02 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `reporting_run_confirmations` | 0 | 0.02 | 0.02 | expires_at / 0 | Keep existing TTL; verify recovery/reporting contract before shortening |
| `historical_api_backfill_checkpoints` | 0 | 0.02 | 0.02 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |
| `reporting_run_manifests` | 0 | 0.02 | 0.02 | expires_at / 0 | Keep existing TTL; verify recovery/reporting contract before shortening |
| `google_oauth_states` | 0 | 0.02 | 0.01 | expires_at / 0 | Keep existing TTL; verify recovery/reporting contract before shortening |
| `google_picker_nonces` | 0 | 0.02 | 0.01 | expires_at / 0 | Keep existing TTL; verify recovery/reporting contract before shortening |
| `reporting_previews` | 0 | 0.02 | 0.01 | expires_at / 0 | Keep existing TTL; verify recovery/reporting contract before shortening |
| `google_picker_selections` | 0 | 0.02 | 0.01 | expires_at / 0 | Keep existing TTL; verify recovery/reporting contract before shortening |
| `public_submission_throttle_buckets` | 0 | 0.02 | 0.01 | expires_at / 0 | Keep existing TTL; verify recovery/reporting contract before shortening |
| `wordpress_form_submission_receipts` | 0 | 0.01 | 0.00 | none | Preserve; no blanket expiration authorized; assess owner/reader contract before cleanup |

## Configuration rules for implementation

- Keep unique keys that enforce receipt identity, one Observation per receipt, Decision attempt, command idempotency, job dedupe and official business invariants. Index use counts do not measure integrity value.
- Use versioned persisted policy for retention classes, worker budgets and pause controls. For new lifecycle-safe TTL, stamp a Date `purge_at` only after terminal state, archive/reference/replay proof where required. Unknown states stay unstamped.
- Do not convert mutable transactional business collections to capped/time-series collections. New bounded metrics may use time-series storage after measuring their need.
- Collection validators should protect newly introduced compact-evidence and retention fields. Inventory existing shape first; rollout warn/validationLevel changes separately before enforcing errors. Mongoose validation is not a database validator.
- No compression override is proposed. collStats reports physical allocation, not a benchmark of changing compressors. Inspect WiredTiger creation settings and benchmark CPU/size on the replica before any rewrite; changing compression is not the first remedy.
- A nonunique diagnostic index may enter hide/observe/drop review. Hidden indexes still consume disk and write work. Preserve serialized index definitions for rollback; rebuilding costs resources and is not instantaneous.
- No collection drop is proposed merely because it is empty, small, unknown or absent from a model. Verify all services and closed historical contracts first.
