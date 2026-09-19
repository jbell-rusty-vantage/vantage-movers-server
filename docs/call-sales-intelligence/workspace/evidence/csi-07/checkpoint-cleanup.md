Fixed one verified regression:

- Transcription cron lease contention now returns `reason: "lease_held"`, matching the documented cron response contract.
- Added regression coverage in `transcriptionWiring.test.ts`.

No Mongo migration, configuration, or external-service behavior changed. Rollback is reverting the two edited files.

Verification was blocked by this isolated workspace’s dependency permissions: Node resolves `tsx` through an inaccessible parent pnpm store, and `pnpm exec` cannot open its user config. No dependencies were installed or changed.

The supplied review had no other findings; my audit found no further substantiated issue.