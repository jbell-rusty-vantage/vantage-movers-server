# Granot Lead Lifecycle — specification index

Companion navigation file for [FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md).

This file is **not an implementation contract** and introduces no requirements. The final specification is authoritative if this index ever drifts. Search for the displayed section or slice ID if a Markdown renderer does not preserve heading links.

## Agent reading protocol

For implementation planning or execution:

1. Start with the applicable [sequential issue slice](#sequential-implementation-slices-s01s23).
2. Read its prerequisites and every governing contract linked from the [task-oriented routes](#task-oriented-routes).
3. Re-check [non-negotiable invariants](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#4-non-negotiable-invariants), [shared contracts](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#7-shared-typescript-contracts), and [field authority](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#15-field-authority-and-desired-state-rules) before changing domain behavior.
4. Carry the slice's acceptance IDs into test names and consult the [acceptance catalog](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#36-acceptance-scenario-catalog).
5. Use the [production file map](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#37-production-file-map), [repository checks](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#352-mandatory-repository-checks), and [rollout sequence](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#39-rollout-and-rollback-sequence) to finish the plan.

Do not implement a slice in isolation from its prerequisites, feature gates, migration/dry-run instructions, live verification, and rollback requirements.

## Task-oriented routes

| If the task concerns… | Read these sections first |
| --- | --- |
| Scope, authority, terminology, or architecture | [1 Purpose](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#1-purpose-and-authority) · [2 Scope](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#2-outcome-scope-and-non-goals) · [4 Invariants](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#4-non-negotiable-invariants) · [5 Language/boundaries](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#5-canonical-language-and-aggregate-boundaries) · [6 Architecture](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#6-end-to-end-architecture) |
| Shared types, schemas, and module seams | [7 TypeScript contracts](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#7-shared-typescript-contracts) · [21 Persistence contracts](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#21-reconciliation-persistence-contracts) · [25 Deep module interfaces](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#25-deep-module-interfaces) · [37 File map](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#37-production-file-map) |
| Source Registry and effect authorization | [8 Source Registry](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#8-authoritative-granot-source-registry) · [15 Field authority](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#15-field-authority-and-desired-state-rules) · [27 Activation/flags](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#27-historical-shadow-activation-and-feature-flags) |
| Webhook or cross-channel receipt capture | [9 Capture/security](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#9-receipt-capture-and-security-contract) · [10 Normalization](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#10-observation-normalization-contract) · [11 Decisions](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#11-ordering-idempotency-and-processing-decisions) · [28 HTTP API](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#28-server-http-api) |
| Lead matching, creation, provenance, or desired state | [12 Identity](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#12-identity-and-source-scope) · [13 Record Link](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#13-granot-record-link) · [14 Aggregate/provenance](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#14-existing-aggregate-additions-and-provenance) · [15 Field authority](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#15-field-authority-and-desired-state-rules) · [16 Lead Created](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#16-lead-created-policy) |
| RingCentral convergence | [12 Identity](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#12-identity-and-source-scope) · [17 RingCentral](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#17-ringcentral-convergence-and-duplicate-safety) · [26 Queue/lease](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#26-queue-lease-retry-and-dead-letter-contract) |
| Booking or Release evidence semantics | [18 Action semantics](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#18-booking-and-release-action-semantics) · [19 Booking reconciliation](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#19-booking-reconciliation) · [20 Release reconciliation](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#20-release-reconciliation) · [21 Persistence](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#21-reconciliation-persistence-contracts) · [22 Discrepancies](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#22-discrepancies) |
| Canonical mutations and owner workflows | [23 Commands/transactions](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#23-canonical-commands-provenance-and-transactions) · [24 Owner inputs](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#24-owner-command-input-contracts) · [28.3 Owner mutations](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#283-owner-mutations) |
| Queueing, retries, dead letter, or manual requeue | [11 Processing decisions](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#11-ordering-idempotency-and-processing-decisions) · [26 Queue/lease/retry](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#26-queue-lease-retry-and-dead-letter-contract) · [33 Operations](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#33-observability-and-operational-health) |
| Shadow mode, flags, rollout, or rollback | [27 Activation/flags](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#27-historical-shadow-activation-and-feature-flags) · [34 Migrations](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#34-migration-scripts-and-commands) · [39 Rollout](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#39-rollout-and-rollback-sequence) · [40 Deferred/fail-closed](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#40-deferred-decisions-and-fail-closed-behavior) |
| Server routes/API behavior | [25 Interfaces](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#25-deep-module-interfaces) · [28 Server API](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#28-server-http-api) · [37 File map](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#37-production-file-map) |
| Vantage Admin | [22 Discrepancies](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#22-discrepancies) · [24 Owner inputs](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#24-owner-command-input-contracts) · [28.2 Admin reads](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#282-admin-reads) · [29 Admin contract](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#29-vantage-admin-contract) |
| Browser extension `0.2.8` | [30 Extension](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#30-browser-extension-contract-028) · [S10](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#s10--cross-channel-extension-receipt-apply-028) |
| HTTP automation | [8.2 Compatibility](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#82-automation-compatibility-record) · [31 Automation convergence](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#31-http-automation-convergence) · [S11](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#s11--cross-channel-http-automation-receipt-apply) |
| Notifications | [32 Notification policy](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#32-notification-policy) · [S22](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#s22--optional-email-notifications) |
| Testing and acceptance | [35 Verification](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#35-verification-strategy) · [36 Acceptance catalog](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#36-acceptance-scenario-catalog) · [41 Complete](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#41-definition-of-complete) |

## Sequential implementation slices (S01–S23)

The sequence and prerequisites below are navigation aids only. Each linked slice contains the complete delivery, flag, migration, verification, and rollback contract.

| Slice | Focus | Repositories | Prerequisites |
| --- | --- | --- | --- |
| [S01](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#s01--freeze-contracts-and-redacted-fixtures) | Contracts and redacted fixtures | server | none |
| [S02](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#s02--secure-channel-neutral-receipt-capture) | Secure channel-neutral receipt capture | server | S01 |
| [S03](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#s03--observation-normalization-and-result-vocabulary) | Observation normalization | server | S02 |
| [S04](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#s04--audited-granot-source-registry) | Audited source Registry | server; admin if needed | S01 |
| [S05](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#s05--decision-activation-record-link-and-operational-reads) | Decision, activation, Record Link, reads | server | S03, S04 |
| [S06](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#s06--durable-drainer-retries-dead-letter-and-manual-requeue) | Durable work execution and recovery | server | S03, S05 |
| [S07](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#s07--aggregate-revisions-command-executor-and-entity-change-foundation) | Canonical transaction foundation | server | S01 |
| [S08](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#s08--lead-provenance-and-identity-parity) | Lead provenance and schema parity | server | S04, S07 |
| [S09](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#s09--source-scoped-identity-and-shadow-lead-desired-state) | Identity and shadow desired state | server | S03–S05, S08 |
| [S10](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#s10--cross-channel-extension-receipt-apply-028) | Browser extension receipt convergence | server, extension | S02, S03, S09 |
| [S11](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#s11--cross-channel-http-automation-receipt-apply) | HTTP automation receipt convergence | server, admin display | S02, S03, S09 |
| [S12](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#s12--enable-safe-matched-lead-writes) | Safe matched-Lead writes | server | S07–S11; parity accepted |
| [S13](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#s13--authorized-lead-creation) | Authorized Lead creation | server | S12 |
| [S14](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#s14--ringcentral-adoption-and-30-minute-leased-cron) | RingCentral adoption and leased cron | server | S08, S13 |
| [S15](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#s15--booking-reconciliation-read-only) | Booking reconciliation reads | server, admin | S05, S09, S12 |
| [S16](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#s16--booking-owner-commands) | Booking owner commands | server, admin | S07, S15; Owner review |
| [S17](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#s17--release-reconciliation-read-only) | Release reconciliation reads | server, admin | S15 |
| [S18](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#s18--release-owner-commands) | Release owner commands | server, admin | S07, S17; Owner review |
| [S19](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#s19--referral-booking) | Referral Booking | server, admin | S16; Registry review |
| [S20](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#s20--discrepancies-and-record-link-correction) | Discrepancies and link correction | server, admin | S16–S18 |
| [S21](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#s21--operational-hardening-and-historical-shadow-certification) | Operational certification | server, admin health | applicable S01–S20 |
| [S22](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#s22--optional-email-notifications) | Optional email notifications | server | case workflows accepted |
| [S23](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#s23--prototype-retirement-and-compatibility-cleanup) | Retirement and compatibility cleanup | all as applicable | stable rollout; all ACs covered |

## Complete section directory

### Foundation and domain contracts

- [1. Purpose and authority](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#1-purpose-and-authority)
- [2. Outcome, scope, and non-goals](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#2-outcome-scope-and-non-goals): [2.1 outcome](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#21-required-outcome) · [2.2 scope](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#22-in-scope) · [2.3 non-goals](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#23-explicit-non-goals) · [2.4 migrations](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#24-verified-current-state-migrations)
- [3. Repository and branch contract](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#3-repository-and-branch-contract)
- [4. Non-negotiable invariants](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#4-non-negotiable-invariants)
- [5. Canonical language and aggregate boundaries](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#5-canonical-language-and-aggregate-boundaries)
- [6. End-to-end architecture](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#6-end-to-end-architecture)
- [7. Shared TypeScript contracts](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#7-shared-typescript-contracts)

### Ingestion, policy, identity, and Lead behavior

- [8. Authoritative Granot source registry](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#8-authoritative-granot-source-registry): [8.1 additions](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#81-granotcrmsource-additions) · [8.2 compatibility](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#82-automation-compatibility-record) · [8.3 classifications](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#83-initial-classifications) · [8.4 effect gates](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#84-layered-effect-gates)
- [9. Receipt capture and security](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#9-receipt-capture-and-security-contract): [9.1 model](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#91-in-place-model-evolution) · [9.2 auth](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#92-webhook-authentication) · [9.3 response](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#93-capture-response) · [9.4 retention](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#94-retention-and-reads)
- [10. Observation normalization](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#10-observation-normalization-contract): [10.1 rules](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#101-normalization-rules) · [10.2 events](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#102-routepayload-event-rules) · [10.3 Priority](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#103-priority-rules)
- [11. Ordering, idempotency, and processing decisions](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#11-ordering-idempotency-and-processing-decisions)
- [12. Identity and Source Scope](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#12-identity-and-source-scope): [12.1 Form](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#121-form-lead-ladder) · [12.2 Call](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#122-call-lead-ladder) · [12.3 Booking](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#123-booking-identity)
- [13. Granot Record Link](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#13-granot-record-link)
- [14. Existing aggregate additions and provenance](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#14-existing-aggregate-additions-and-provenance): [14.1 revisions](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#141-shared-aggregate-revision-fields) · [14.2 origin](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#142-ingestion-origin) · [14.3 Lead fields](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#143-lead-field-additions) · [14.4 validation](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#144-contextual-validation)
- [15. Field authority and desired-state rules](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#15-field-authority-and-desired-state-rules): [15.1 WordPress Form](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#151-wordpress-created-form-lead) · [15.2 RingCentral Call](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#152-ringcentral-created-call-lead) · [15.3 Granot-created](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#153-granot-created-form-or-call-lead) · [15.4 Agent](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#154-agent-identity)
- [16. Lead Created policy](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#16-lead-created-policy): [16.1 matched](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#161-matched-existing-path) · [16.2 no match](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#162-no-match-behavior) · [16.3 minimum data](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#163-minimum-creation-data)
- [17. RingCentral convergence and duplicate safety](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#17-ringcentral-convergence-and-duplicate-safety)

### Reconciliation, commands, and runtime

- [18. Booking and Release action semantics](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#18-booking-and-release-action-semantics)
- [19. Booking Reconciliation](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#19-booking-reconciliation)
- [20. Release Reconciliation](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#20-release-reconciliation)
- [21. Reconciliation persistence contracts](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#21-reconciliation-persistence-contracts): [21.1 shared](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#211-shared-case-subdocuments) · [21.2 Booking case](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#212-granotbookingreconciliationcase) · [21.3 Release case](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#213-granotreleasereconciliationcase) · [21.4 refresh/revisions](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#214-evidence-refresh-and-revisions) · [21.5 sequence](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#215-sequence-allocation)
- [22. Discrepancies](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#22-discrepancies)
- [23. Canonical commands, provenance, and transactions](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#23-canonical-commands-provenance-and-transactions): [23.1 execution](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#231-domaincommandexecution-evolution) · [23.2 executor](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#232-command-executor-transaction-contract) · [23.3 changes](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#233-entitychange) · [23.4 commands](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#234-newextended-canonical-commands)
- [24. Owner command input contracts](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#24-owner-command-input-contracts): [24.1 confirm Booking](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#241-confirm-missing-standard-booking) · [24.2 update Booking](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#242-update-existing-booking) · [24.3 Referral](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#243-create-referral-booking) · [24.4 Cancellation](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#244-confirm-cancellation) · [24.5 No Action](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#245-no-action)
- [25. Deep module interfaces](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#25-deep-module-interfaces)
- [26. Queue, lease, retry, and dead-letter contract](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#26-queue-lease-retry-and-dead-letter-contract)
- [27. Historical shadow, activation, and feature flags](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#27-historical-shadow-activation-and-feature-flags): [27.1 activation](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#271-activation-model) · [27.2 flags](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#272-flags-and-defaults)

### Interfaces and operations

- [28. Server HTTP API](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#28-server-http-api): [28.1 capture/apply](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#281-captureapply-compatibility-endpoints) · [28.2 reads](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#282-admin-reads) · [28.3 mutations](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#283-owner-mutations) · [28.4 errors](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#284-error-mapping)
- [29. Vantage Admin contract](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#29-vantage-admin-contract): [29.1 routes](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#291-navigation-and-routes) · [29.2 files](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#292-files) · [29.3 behavior](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#293-listdetail-behavior) · [29.4 accessibility](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#294-accessibility-and-safety)
- [30. Browser extension contract (`0.2.8`)](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#30-browser-extension-contract-028): [30.1 version](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#301-version-and-branch) · [30.2 preview](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#302-preview-remains-read-only) · [30.3 payload](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#303-final-apply-payload) · [30.4 IDs](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#304-stable-operation-ids) · [30.5 response](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#305-compatibility-response) · [30.6 tests](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#306-extension-tests)
- [31. HTTP automation convergence](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#31-http-automation-convergence)
- [32. Notification policy](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#32-notification-policy)
- [33. Observability and operational health](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#33-observability-and-operational-health)

### Delivery, validation, and completion

- [34. Migration scripts and commands](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#34-migration-scripts-and-commands): [34.1 receipts](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#341-receipt-migration) · [34.2 Registry](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#342-source-registry-migration) · [34.3 Lead provenance](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#343-lead-provenance-migration) · [34.4 revisions](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#344-aggregate-revision-migration) · [34.5 indexes](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#345-index-deployment) · [34.6 shadow](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#346-historical-shadow-run) · [34.7 rollback](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#347-rollback-artifacts)
- [35. Verification strategy](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#35-verification-strategy): [35.1 levels](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#351-test-levels) · [35.2 repository checks](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#352-mandatory-repository-checks)
- [36. Acceptance scenario catalog (AC-01–AC-40)](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#36-acceptance-scenario-catalog)
- [37. Production file map](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#37-production-file-map): [37.1 server files](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#371-vantage-main-server) · [37.2 documentation drift](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#372-documentation-drift-updates-required-during-implementation)
- [38. Sequential issue slices (S01–S23)](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#38-sequential-issue-slices)
- [39. Rollout and rollback sequence](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#39-rollout-and-rollback-sequence)
- [40. Deferred decisions and fail-closed behavior](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#40-deferred-decisions-and-fail-closed-behavior)
- [41. Definition of complete](./FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md#41-definition-of-complete)

