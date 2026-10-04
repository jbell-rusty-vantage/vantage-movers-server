# Baseline before slimming

Measured 2026-10-03 in clean detached worktrees: server `6a374fab`, Admin `adda9e1`. Each worktree's node_modules is a junction to its main checkout.

| Repo | Typecheck | Unit tests |
| --- | --- | --- |
| server | `pnpm typecheck` exit 0 | `DOTENV_CONFIG_PATH=<missing> pnpm test`: 3119 tests, 2950 pass, **34 fail** (the rest skipped) |
| Admin | `tsc --noEmit` exit 0 | `node --import tsx --test "{lib,server,tests}/**/*.test.ts"`: 1132 tests, 948 pass, 0 fail |

Run the Admin tests with node or tsc directly from a worktree. `pnpm` tries to reinstall, and a reinstall would remove the junctioned node_modules.

## Server failures already on main (titles)

```text
✖ api\queues\granot-lifecycle-consumer.test.ts
✖ api\queues\sales-intelligence-consumer.test.ts
✖ failing tests:
✖ ops\lib\attention-storage-guard.test.ts
✖ ops\lib\backfill-csi-structured-analysis.lib.test.ts
✖ ops\lib\call-log-repair.test.ts
✖ ops\lib\csi-enqueue-replica-target.test.ts
✖ ops\lib\form-lead-numbers-backfill.test.ts
✖ ops\lib\full-backfill.test.ts
✖ ops\lib\production-writer-guard.test.ts
✖ request telemetry stays in HTTP/application logs while auth denials still reach the event writer
✖ src\auth\extension\tokens.test.ts
✖ src\config\domain\bookingReconciliation.test.ts
✖ src\config\domain\cpl.test.ts
✖ src\config\domain\googleAuth.test.ts
✖ src\config\domain\granotLifecycle.test.ts
✖ src\config\domain\granotWebhook.test.ts
✖ src\config\domain\leadMessaging.test.ts
✖ src\config\domain\observability.test.ts
✖ src\config\domain\tariffCatalog.test.ts
✖ src\middleware\requireApiSecret.test.ts
✖ src\models\CancelledLead.test.ts
✖ src\models\FormLead.test.ts
✖ src\models\GranotCrmSource.test.ts
✖ src\models\GranotObservation.test.ts
✖ src\models\GranotObservationReceipt.test.ts
✖ src\models\LeadConversation.test.ts
✖ src\models\LeadMessage.test.ts
✖ src\models\LeadMessageRateLimit.test.ts
✖ src\routes\admin-invite-email-internal.routes.test.ts
✖ src\routes\booking-reconciliation-cron.routes.test.ts
✖ src\routes\granot-crm-sources.routes.test.ts
✖ src\routes\granot-webhook.routes.test.ts
✖ src\routes\sales-intelligence-admin.routes.test.ts
✖ src\routes\sales-intelligence-admin.timeline.test.ts
```
