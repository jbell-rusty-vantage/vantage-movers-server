# Vercel Prebuilt Deploys And Scripts Guide

## Goal

Build each project in CI, keep the generated Vercel build output as the deploy artifact, and upload that artifact to Vercel with `vercel deploy --prebuilt`.

This is useful when GitHub or another CI system should be the place that typechecks, tests, and builds the project, while Vercel receives only the already-built `.vercel/output` directory.

The important distinction is:

- Do not commit `.vercel/output` to Git.
- Do create `.vercel/output` during CI with `vercel build`.
- Do pass that exact output directory to `vercel deploy --prebuilt`.

Vercel's supported artifact flow is:

```bash
vercel pull --yes --environment=production --token "$VERCEL_TOKEN"
vercel build --prod --token "$VERCEL_TOKEN"
vercel deploy --prebuilt --prod --token "$VERCEL_TOKEN"
```

`vercel build` writes the Build Output API artifact to `.vercel/output` by default. `vercel deploy --prebuilt` uploads that artifact instead of asking Vercel to rebuild from source.

## Repository Shape

This workspace currently has separate projects, not one root monorepo:

- `vantage-main-server/` is a TypeScript Express API deployed as Vercel Functions. It has `api/index.ts`, `vercel.json`, rewrites, queue trigger config, and cron jobs.
- `vantage-admin/` is a Next.js app. It has `next.config.ts`, `app/`, and a normal `next build`.

Even though the requested flow says "TypeScript Next.js codebase" for both, only `vantage-admin/` is Next.js. `vantage-main-server/` is TypeScript, but Vercel builds it as a functions API from `vercel.json` and the `api/` directory.

## One-Time Vercel Setup

Each folder should be linked to its own Vercel project:

```bash
cd vantage-main-server
pnpm install
pnpm vercel link
```

```bash
cd ../vantage-admin
pnpm install
pnpm vercel link
```

This creates each project's `.vercel/project.json`. The `.vercel` directory is correctly ignored by Git, so CI should recreate it with `vercel pull`.

Required CI secrets per project:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

If both projects deploy from the same CI workflow, use project-specific names such as:

- `VERCEL_MAIN_SERVER_PROJECT_ID`
- `VERCEL_ADMIN_PROJECT_ID`

## Recommended CI Flow

Run each project independently from its own working directory. Do not run `vercel build` from the workspace root.

### `vantage-main-server`

Recommended checks before deploy:

```bash
cd vantage-main-server
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
vercel pull --yes --environment=production --token "$VERCEL_TOKEN"
vercel build --prod --token "$VERCEL_TOKEN"
vercel deploy --prebuilt --prod --token "$VERCEL_TOKEN"
```

Notes:

- `pnpm typecheck` currently runs `tsc --noEmit` across `api/**/*.ts`, `scripts/**/*.ts`, and `types/**/*.d.ts`.
- `pnpm test` currently runs Node's test runner against `api/**/*.test.ts`.
- `vercel build --prod` produces `.vercel/output`.
- `vercel deploy --prebuilt --prod` uploads `.vercel/output` to production.
- Add `--archive=tgz` to `vercel deploy --prebuilt` if uploads become large or slow.

### `vantage-admin`

Recommended checks before deploy:

```bash
cd vantage-admin
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
vercel pull --yes --environment=production --token "$VERCEL_TOKEN"
vercel build --prod --token "$VERCEL_TOKEN"
vercel deploy --prebuilt --prod --token "$VERCEL_TOKEN"
```

Notes:

- `pnpm build` runs `next build`, but in this deployment flow `vercel build --prod` is the build command that matters because it emits the `.vercel/output` artifact Vercel can upload.
- You can still run `pnpm build` as an earlier validation step if you want a plain Next.js build check, but it is not the deploy artifact.
- `vantage-admin/.gitignore` already ignores `.next/`, `out/`, and `.vercel`.

## GitHub Actions Example

This example deploys both projects from one workflow. It intentionally builds in each project folder.

```yaml
name: Deploy Vercel Prebuilt

on:
  push:
    branches: [main]

jobs:
  deploy-main-server:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: vantage-main-server
    env:
      VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
      VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
      VERCEL_PROJECT_ID: ${{ secrets.VERCEL_MAIN_SERVER_PROJECT_ID }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10.13.1
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: vantage-main-server/pnpm-lock.yaml
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm vercel pull --yes --environment=production --token "$VERCEL_TOKEN"
      - run: pnpm vercel build --prod --token "$VERCEL_TOKEN"
      - run: pnpm vercel deploy --prebuilt --prod --archive=tgz --token "$VERCEL_TOKEN"

  deploy-admin:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: vantage-admin
    env:
      VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
      VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
      VERCEL_PROJECT_ID: ${{ secrets.VERCEL_ADMIN_PROJECT_ID }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10.13.1
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: vantage-admin/pnpm-lock.yaml
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm vercel pull --yes --environment=production --token "$VERCEL_TOKEN"
      - run: pnpm vercel build --prod --token "$VERCEL_TOKEN"
      - run: pnpm vercel deploy --prebuilt --prod --archive=tgz --token "$VERCEL_TOKEN"
```

If preview deployments are needed, replace `--environment=production`, `--prod`, and production project IDs with the preview equivalent. For a production deploy, keep `--prod` on both `vercel build` and `vercel deploy`.

## What To Commit

Keep these committed:

- Source files in `api/`, `app/`, `components/`, `lib/`, `server/`, and other runtime source directories.
- `package.json`, lockfiles, `tsconfig.json`, `next.config.ts`, and `vercel.json`.
- Documentation and runbooks that describe production behavior.
- CI workflow files once added.

Keep these ignored:

- `.vercel/`
- `.vercel/output` and `.vercel_build_output`
- `.next/`
- `dist/`, `build/`, `out/`
- env files and generated credential/token files
- generated logs and one-off diagnostic output

## RingCentral Runtime Boundary

RingCentral is part of the deployed API. The deploy-critical code is not in `scripts/ringcentral`; it is in the API runtime:

- `api/index.ts` mounts the RingCentral routes.
- `api/routes/ringcentral-webhook.routes.ts` handles `/api/webhooks/ringcentral`.
- `api/routes/ringcentral-webhook-local.routes.ts` handles local webhook capture.
- `api/routes/ringcentral-cron.routes.ts` handles `/api/cron/ringcentral-call-log-sync` and `/api/cron/ringcentral-analytics-reconcile`.
- `api/services/ringcentral/` contains auth, webhook capture, call aggregation, call log sync, analytics reconcile, duplicate guard, and ingest logic.
- `api/services/leads/callLead.service.ts` creates RingCentral-backed call leads.
- `api/models/CallLead.ts` contains RingCentral metadata and idempotency indexing.
- `vercel.json` schedules the RingCentral cron endpoints.

Those files must stay in Git and must be included in the Vercel build.

The files under `scripts/ringcentral/` are operational wrappers, probes, and local test tools. They are not mounted as HTTP API routes by Vercel. However, many of them are currently first-class `package.json` scripts, so moving them without updating `package.json` will break commands.

## RingCentral Scripts Triage

You said you want to keep create, delete, monitor, and webhook testing. Based on the current scripts, this is a reasonable split.

Keep tracked if these commands should remain supported:

- `scripts/ringcentral/ringcentral-webhook-create.ts`
- `scripts/ringcentral/ringcentral-webhook-create-local.ts`
- `scripts/ringcentral/ringcentral-webhook-delete.ts`
- `scripts/ringcentral/ringcentral-webhook-delete-all.ts`
- `scripts/ringcentral/ringcentral-webhook-monitor.ts`
- `scripts/ringcentral/ringcentral-workflow-test.ts`
- `scripts/ringcentral/RINGCENTRAL-PRODUCTION-RUNBOOK.md`

Optionally keep tracked:

- `scripts/ringcentral/ringcentral-webhook-list.ts`

The list command is not in your stated keep set, but it is low-risk and useful before deleting subscriptions. If you remove it, remove the `ringcentral:webhook:list` package script too.

Safe to move to a gitignored local folder after removing or changing their `package.json` commands:

- `scripts/ringcentral/ringcentral-diagnose.ts`
- `scripts/ringcentral/ringcentral-call-log-validate.ts`
- `scripts/ringcentral/ringcentral-call-lead-api-probe.ts`
- `scripts/ringcentral/ringcentral-call-log-sync-run.ts`
- `scripts/ringcentral/ringcentral-analytics-reconcile-run.ts`
- `scripts/ringcentral/RINGCENTRAL-HYBRID-IMPLEMENTATION-PLAN.md`

Why these can move:

- `ringcentral-diagnose.ts`, `ringcentral-call-log-validate.ts`, and `ringcentral-call-lead-api-probe.ts` are diagnostics/probes.
- `ringcentral-call-log-sync-run.ts` and `ringcentral-analytics-reconcile-run.ts` manually invoke runtime services that are already exposed through deployed cron routes.
- `RINGCENTRAL-HYBRID-IMPLEMENTATION-PLAN.md` appears to be an implementation planning artifact, while the production runbook is the better tracked reference.

Do not move the `api/services/ringcentral/` files just because a script imports them. The scripts depend on the API services, not the other way around.

## Other Scripts Triage

The current server `scripts/` directory mixes local operations, migrations/backfills, demos, generated docs, and dev server entry points.

Keep tracked:

- `scripts/dev-server.ts`, because `pnpm dev` and `pnpm dev:local` use it.
- Any script that is intentionally part of a repeatable production runbook.
- Any migration/backfill script that may need to be rerun or audited later.

Already ignored:

- `scripts/dev_ops/` is ignored as personal or destructive DB-hitting utilities.
- `scripts/docs/**` is ignored as generated output.
- RingCentral token, subscription, validation, probe, sync, reconcile, workflow, log, and local webhook event output files are ignored.

Candidates for a gitignored local-only folder:

- `scripts/demos/`, if demos are only for personal testing.
- `scripts/postman/`, if Postman sync/login is not part of team workflow.
- individual Google Sheets inspection/dump scripts that only produce local diagnostics.

Be more conservative with:

- `scripts/google_sheets/backfill-master-leads-sheet.ts`
- `scripts/google_sheets/repair-master-leads-source-labels.ts`
- `scripts/google_sheets/resync-failed-sheet-sync-via-api.ts`
- `scripts/historical/**`

These sound like operational repair or migration tools. Even if they are not part of the Vercel API, keeping them tracked can be valuable for auditability and repeatability.

## Suggested Local-Only Folder Pattern

If you want to move personal utilities out of tracked code, use one ignored folder and make the policy explicit:

```gitignore
# Local-only operational scratch scripts.
# Do not reference these from package.json.
scripts/local_only/
```

Then either:

1. Move the unwanted files to `scripts/local_only/` and remove their `package.json` script entries, or
2. Leave the files tracked but remove the package script aliases so they stop looking like supported team commands.

The first option makes the repository smaller. The second option preserves history and discoverability.

## Package Script Cleanup If Moving RingCentral Tools

If keeping only create, delete, monitor, and workflow testing, keep these entries:

```json
{
  "ringcentral:webhook:create": "node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/ringcentral/ringcentral-webhook-create.ts",
  "ringcentral:webhook:create:local": "node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/ringcentral/ringcentral-webhook-create-local.ts",
  "ringcentral:webhook:delete": "node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/ringcentral/ringcentral-webhook-delete.ts",
  "ringcentral:webhook:delete:all": "node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/ringcentral/ringcentral-webhook-delete-all.ts",
  "ringcentral:webhook:monitor": "node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/ringcentral/ringcentral-webhook-monitor.ts",
  "ringcentral:workflow:test": "node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/ringcentral/ringcentral-workflow-test.ts"
}
```

Remove or relocate these entries if the files move to a gitignored folder:

```json
{
  "ringcentral:diagnose": "...",
  "ringcentral:call-log:validate": "...",
  "ringcentral:call-lead:api-probe": "...",
  "ringcentral:call-log:sync:run": "...",
  "ringcentral:analytics:reconcile:run": "..."
}
```

Also decide whether to keep or remove:

```json
{
  "ringcentral:webhook:list": "..."
}
```

## Typecheck Warning Before Moving Scripts

`vantage-main-server/tsconfig.json` includes `scripts/**/*.ts`. If files remain under `scripts/local_only/`, TypeScript will still typecheck them.

If the local-only folder is ignored and may contain broken scratch scripts, update `tsconfig.json`:

```json
{
  "exclude": ["scripts/local_only/**"]
}
```

Do this only if you intentionally allow local-only scripts to drift. If a script should stay reliable, keep it tracked and typechecked.

## Recommended Next Steps

1. Add CI workflows using `vercel build` plus `vercel deploy --prebuilt`.
2. Keep `.vercel/output` ignored and treat it as a CI artifact only.
3. Decide whether `ringcentral:webhook:list` should stay supported.
4. Move only diagnostic/probe/manual-run RingCentral scripts to a gitignored folder, then remove their `package.json` entries.
5. Keep all `api/services/ringcentral`, `api/routes/ringcentral-*`, and `vercel.json` RingCentral cron config tracked because they are deployed API behavior.
