# CSI-01 infrastructure map

Preparation slice only. This is a reuse/adaptation map, not a claim that CSI-01 models, jobs, auth, or migrations exist.

Paths without a repo prefix are in `vantage-main-server`.

## Validation

| Path | What it is | CSI reuse |
| --- | --- | --- |
| `src/validation/v1/*.validation.ts` | Route/command Zod modules; `.strict()` and `z.discriminatedUnion` are the house style | **Reuse the style, not the barrel.** New envelope lives beside them, not inside them. |
| `src/validation/v1/common.ts` | Shared scalars (`nonEmptyString`, ObjectId, dates). Query-oriented `coerce` helpers | **Adapt.** Envelope input is model JSON, so this slice does not coerce strings to numbers/dates. |
| `src/validation/v1.validation.ts` | Public re-export used by routes and `domainCommands` | **Do not add the envelope here** until a later CSI-01 route/DTO freeze. Adding it would couple schema work to the Owner API. |
| `src/validation/v1/employeeBookings.validation.ts` | Best local precedent: strict objects + discriminated union + `superRefine` | **Reuse the pattern.** |
| `src/validation/v1/granotLifecycle.validation.test.ts` | Rejects unknown keys with `unrecognized_keys` | **Reuse the test idiom.** |
| `src/services/historicalConsolidation/schemaValidation.ts` | Mongoose production-schema parity, not Zod envelopes | Not a template for document 10. |
| **`src/validation/intelligence/intelligenceEnvelope.validation.ts`** | This slice: `csi-envelope-v1` | Isolated. Not imported by routes, workers, models, or production services. |
| `src/validation/reporting.validation.ts` | Validation that is not a v1 Owner-API schema | Precedent for keeping the envelope outside `v1/`. |

**Module location:** house-style v1 route schemas live at `src/validation/v1/<domain>.validation.ts` and are re-exported from the barrel. Document 04 names `src/validation/v1/salesIntelligence.ts` for later Owner HTTP DTOs. This slice does **not** use that path: the envelope is model output, not an HTTP command body. Putting it under `v1/` without a barrel export would still look like a route schema. `src/validation/intelligence/` follows the reporting precedent and stays off `v1.validation.ts`. Later HTTP validators can land in `salesIntelligence.validation.ts` and join the barrel then.

This slice implements **schema validation only**. Runtime evidence authorization (snapshot/subject/follow-up existence) and business-effect validation (live revisions, allowed effects, Owner precedence) are later work. Routes use `.parse` and map `ZodError` to 400; `safeParse` is the test/inspection path.

## Tests

| Path | What it is | CSI reuse |
| --- | --- | --- |
| `package.json` `test` | `node --import tsx --import ./scripts/test-setup.ts --test "src/**/*.test.ts" ...` | New `*.test.ts` under `src/` is picked up automatically. |
| `src/validation/v1/*.validation.test.ts` | Colocated `node:test` + `node:assert/strict` | **Reuse.** This slice follows that layout. |
| `scripts/test-setup.ts` | Shared test bootstrap | Reuse as-is. |
| Replica/integration tests (`*.replica.test.ts`, `*.integration.test.ts`) | Need Mongo replica / live fixtures | **Out of scope.** Envelope tests are pure and synthetic. |

## Models

| Path | What it is | CSI reuse |
| --- | --- | --- |
| `src/models/LeadConversation.ts` | `getXModel()`, `X_INDEXES`, `autoIndex: false`, nullable lead ref | **Reuse later** for CSI models (02 §0). Not opened in this slice. |
| `src/models/schemaHelpers.ts` | Shared Mongoose field helpers | Later CSI models can extend; do not overload with envelope fields. |
| `src/config/domain.ts` + `src/config/domain/*` | Closed enums barrel | Later: `src/config/domain/salesIntelligence.ts`. Not created here. |
| `src/models/EntityChange.ts` | Official change log; closed source/entity enums | **Adapt.** CSI needs its own ledger (02 §17). Do not write CSI effects into EntityChange. |

## Transactions and commands

| Path | What it is | CSI reuse |
| --- | --- | --- |
| `src/db.ts` `withTransaction` | Mongo multi-document transaction; callback must be idempotent | **Reuse later** for submit→store→enqueue. Not used by the validator. |
| `src/config/domain/runtime.ts` | `TEST_MODE` / `getMongoDatabaseName()` | **Reuse later** for CSI collections. Envelope tests do not touch Mongo. |
| `src/services/domainCommands/*` | Canonical Lead/Booking/Cancellation commands; origins `external_sheet_ingestion` \| `vantage_admin` \| `granot_lifecycle` \| `ringcentral` | **Adapt.** Intelligence commands must not widen those origins (04 §11). Separate CSI command ledger. |
| `src/services/domainCommands/idempotency.ts` | Origin + idempotency key + payload checksum; conflict on changed payload | **Reuse the idea** for run-bound envelope submission. Do not store CSI submissions as Lead commands. |

## Jobs and durable work

| Path | What it is | CSI reuse |
| --- | --- | --- |
| `src/services/durableWork/leases.ts` | Scope/owner/epoch lease store | **Reuse later** for analysis/apply workers. Audit 11: cron cadence is not a fence. |
| `src/services/durableWork/schema.ts` | Lease/run-control Mongoose field helpers | **Reuse later** on CSI job documents. |
| `src/services/durableWork/index.ts` | Actors, checksums, checkpoints, transitions. **No enqueue helper** — wake-up is per-domain (`granotLifecycle/queuePublisher.ts`, sheet-sync outbox) | **Reuse later.** Validator does not enqueue work. Spec later: `api/queues/sales-intelligence-consumer.ts`. |
| `api/queues/*`, `vercel.json` | Standalone consumers need bootstrap + registration | Later CSI workers. A handler file alone is not registration (audit 11). |

## Authentication

| Path | What it is | CSI reuse |
| --- | --- | --- |
| `src/middleware/requireApiSecret.ts` | `requireVantageAuth` aliased as `requireApiSecret`; broad `VANTAGE_API_SECRET`, scoped keys, Bearer | **Adapt.** Internal run token alone cannot pass this guard (audit 11, 04 §6, 10 §9). Need scoped static key + signed run token. |
| `src/routes/v1.routes.ts` | `router.use("/api/v1", requireApiSecret)` | **Do not hang CSI internals off the broad secret.** Owner routes stay after the existing guard. |
| `vantage-admin/server/auth/authorization.ts` | Admin role gates and proxy allowlists | Later CSI Owner routes. Unused this slice. |
| `vantage-admin/app/api/proxy/[...path]/route.ts` | BFF: selective Idempotency-Key, buffered streaming, transformed errors | Later CSI adapters (audit 11). |
| `vantage-admin/lib/state/database-scope.tsx` + server `src/services/admin/adminScope.service.ts` | Browser `production` / `historical` / `combined` vs server `TEST_MODE` | **Adapt later.** CSI is current-records only; reject unsupported scopes. Not a validator concern. |

## Migrations

| Path | What it is | CSI reuse |
| --- | --- | --- |
| `scripts/migrations/README.md` | Report default; apply requires `--apply --confirm-production=<db>`; verify | **Reuse later.** |
| `scripts/migrations/lead-conversation-indexes.ts` | `X_INDEXES` report/apply/verify; no runtime `autoIndex` | Specified CSI template (`scripts/migrations/sales-intelligence-indexes.ts`). **Not created** in this slice. |
| `scripts/historical_production_db_staged_merge_ingestion/{plan,apply,verify}.ts` | Historical consolidation pipeline | Unrelated to CSI current-record migrations. |

## Dashboard

`vantage-admin` branch `sales-intelligence` was created from `main` (`2021ae5`). No Admin files changed. Later CSI UI consumes frozen DTOs; it must not copy envelope or effect rules.
