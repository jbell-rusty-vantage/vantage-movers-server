# Granot Lead Lifecycle — agent execution runbook

## 1. Mission

The main goal is to build a production-safe Granot Lead Lifecycle that:

1. accepts each authenticated Granot webhook delivery, approved browser-extension apply, and approved HTTP-automation action as a credential-redacted `GranotObservationReceipt`;
2. passes every receipt through one channel-neutral processor that preserves evidence and resolves Registry policy, source-scoped Lead identity, temporal order, and desired state;
3. applies only authorized Lead linking, creation, or enrichment through canonical domain commands; and
4. feeds repeatable Granot `Booked` and `Release` observations into precise owner-controlled Booking Reconciliation and Release Reconciliation, where official Booking or Cancellation facts change only after explicit owner commands.

Older drafts called the final part Booking Intake and Cancellation Intake. Those names and their implied authority are superseded. Granot evidence is not authority for an official Booking or Cancellation. It must never automatically create or update a Booking or cancel or un-cancel one.

The completed system must be channel-neutral, idempotent, source-scoped, revision-guarded, transactionally causal, privacy-safe, observable, incrementally gated, and reversible by disabling the narrowest effect while retaining durable evidence and committed official facts.

## 2. Authority and conflict handling

Use this order whenever sources disagree:

1. `scripts/prototypes/granot-lead-lifecycle/specs/FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md` — implementation contract.
2. workspace-root `CONTEXT.md` — canonical domain language.
3. `FINAL-PRE-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md` — locked product decisions only when the final specification points back to them.
4. `lead_lifecycle_issue_breakdown_reccomendation.md` — unit number, dependencies, repositories, flags, and issue spine.
5. `SUGGESTED-DOMAIN-MODELS-AND-PROVENANCE.md` — secondary persistence-depth guidance only.
6. prototype scenarios and code — executable examples only after rewriting outcomes into final-spec language.

Do not use older Intake, generic-lifecycle-engine, or superseded production-spec documents as authority. If sources conflict, stop that line of implementation, report the exact contradiction, and follow the higher authority. If a required business rule remains unspecified, fail closed under final-spec Section 40; do not invent source IDs, mappings, payload meanings, occurrence times, or authority.

## 3. Locked decisions inherited by every unit

- `FormLead.ref_no` is posted to Granot as `leadno`; Mongo `_id` remains compatibility identity only.
- `lead_created` follows reviewed Registry source policy and may create a Lead immediately only when authorized.
- Store every valid Granot Priority value; only `1` and `5` authorize broad enrichment and set `quoted = true`; no Priority value sets it false.
- `Booked` and `Release` are repeatable Granot Booking Actions, not stored Vantage lifecycle transitions.
- Use Booking Reconciliation and Release Reconciliation, never Booking Intake or Cancellation Intake.
- An actual `Booked` action against an existing Booking opens review work.
- Granot never automatically creates, updates, cancels, or un-cancels a Booking.
- Change the RingCentral Call Log schedule to 30 minutes only after convergence, lease, and overlap-safety proof is live.

## 4. Program invariants

Every primary agent must read final-spec Section 4 in full and identify which numbered invariants its unit could violate. At minimum preserve:

1. MongoDB is the System of Record.
2. A Granot Observation is evidence, not authority for official Booking or Cancellation facts.
3. Lead Lifecycle is composed from current facts and is not stored as an enum.
4. At most one Vantage Booking exists per normalized Job Number.
5. Only canonical domain commands mutate Leads, Bookings, or Cancellations.
6. Every post-activation aggregate mutation records its Decision, idempotent command execution, `EntityChange`, revision transition, and Sheet Sync outbox intent atomically.
7. No-op desired-state comparisons create neither `EntityChange` nor Sheet Sync work.
8. Source System, Observation Channel, Ingestion Origin, actor, and initiator remain separate provenance axes.
9. Immutable creation/submission evidence is never overwritten.
10. Identity conflict never reassigns Source Company, Source Granularity, Ingestion Origin, or CPL.
11. Duplicate and Bad Form Lead restrictions remain exact.
12. Resolved reconciliation cases never reopen; later same-kind actions use the next sequence.

## 5. Repository and branch contract

| Repository | Required branch | Ownership |
| --- | --- | --- |
| `vantage-main-server` | `granot-lead-lifecycle` | models, services, migrations, processor, queues/crons, canonical commands, APIs |
| `vantage-admin` | `granot-lead-lifecycle` | Registry and lifecycle queues, details, timelines, owner forms |
| `granot_sync_extensions_and_services` | `main` | receipt-based extension apply and version `0.2.8` |

Do not create per-unit branches. Before editing each affected repository, run `git status --short`, `git branch --show-current`, and inspect recent relevant changes. Existing or unexplained changes belong to the user or a predecessor and must be preserved. Do not commit, push, deploy, apply production migrations, enable production effects, or send live customer payloads unless the user separately authorizes that exact action.

Cross-repository units designate the server contract as authoritative unless the unit explicitly names another boundary. Land and verify server compatibility before making UI or client work depend on it.

## 6. Unit readiness and ownership

- One primary agent session owns one numbered unit end to end.
- Begin only when every listed prerequisite is complete and its evidence is verified against the current repositories.
- A prose handoff or status ledger is navigation, not proof.
- The primary agent owns specification interpretation, integration design, transaction boundaries, final edits crossing module seams, authoritative test inspection, and the completion audit.
- Parallel implementation is exceptional. It requires dependency permission, non-overlapping files and contracts, and an explicit integration owner on the shared lifecycle branches.
- Do not implement a later unit merely because its abstraction would make the current test easier.

## 7. Start-of-unit protocol

Before edits, the primary agent must:

1. read this runbook and the entire unit contract;
2. read the cited final-spec sections in full, plus Sections 1–2, 4–7, the matching Section 36 AC rows, the applicable Section 38 slice, and Sections 39–41 when enabling effects;
3. read `AGENTS.md`, `CLOUD_AGENTS.md`, applicable `.cursor/rules/*.mdc`, and repository-local instructions for every affected repo;
4. verify branches, working trees, and recent relevant changes;
5. verify predecessor deliverables, tests, migrations/indexes, and ending flags in repository state;
6. confirm environment posture before any runtime write: `TEST_MODE`, selected Mongo database, replica-set availability, Sheet Sync mode, lifecycle flags, RingCentral collection/write mode, and external targets;
7. identify the production module boundary to extend; routes, scripts, Admin, and extension clients must not own lifecycle business policy;
8. map every assigned AC ID to a concrete failing or existing test location before implementation; and
9. state any contradiction or fail-closed gap before relying on it.

## 8. Optional specification-extraction step

Cursor environments may invoke `.cursor/agents/lead-lifecycle-spec-extractor.md`. Other agents, including Codex, may read and apply that file as a bounded extraction protocol even when they cannot invoke the Cursor reusable-agent name directly.

The extraction step may gather exact types, enums, outcomes, invariants, AC sentences, flags, migration rules, production seams, and forbidden behavior for the target unit. It must not implement code, decide contradictions, or claim unit completion. The primary agent must itself read the authoritative sections and owns all interpretation.

If subagents are available, useful bounded tasks include:

- locating existing model/service/test extension points;
- independently mapping AC IDs to missing tests;
- reviewing one concern such as transaction atomicity, PII/security, indexes/migrations, RingCentral duplicates, accessibility, or API compatibility;
- implementing an isolated Admin component or extension adapter after the server contract is fixed;
- running a focused regression and investigating failures without touching unrelated code; and
- adversarially reviewing the final diff against exact cited sections.

Do not delegate the whole unit, authoritative-spec interpretation, live data access, production changes, or overlapping edits to the same transaction coordinator/model/migration/route.

Each subagent returns: bounded task; files inspected or changed; findings tied to sections/ACs; exact tests and outcomes; risks/contradictions; overlap status; and an explicit statement that it is not claiming whole-unit completion.

## 9. Implementation rules

- Keep routes thin: authentication, strict Zod validation, module call, safe response.
- Runtime policy belongs under `src/services/granotLifecycle/`; migration scripts call runtime services rather than reimplementing policy.
- Pass receipt, observation, decision, case, and command identities across boundaries rather than raw payloads.
- Keep compatibility adapters one-way toward the common processor; old extension or automation patch paths must never bypass receipts after cutover.
- Treat duplicate-key, lease, compare-and-swap, replay, checksum conflict, no-op, and already-current paths as first-class acceptance behavior.
- Effect-bearing tests prove causal references and transaction atomicity, not just final aggregate values.
- No-op and shadow tests explicitly prove absence of forbidden aggregate mutations, `EntityChange`, Sheet Sync, cases, discrepancies, and notifications as applicable.
- Never broaden an effect gate to pass a test.
- Update behavior docs and rules in the unit that changes behavior; do not defer all documentation to Unit 33.

## 10. Data, privacy, and environment safety

- Use redacted synthetic fixtures for implementation and ordinary verification.
- Never commit current customer payloads, credentials, authorization/cookies, realistic phones/emails/addresses, or live database output.
- Raw payloads belong only in the exact protected evidence location authorized by the specification; they must not enter lifecycle projections, logs, test names, issue text, hook prompts/output, subagent/model output, migration reports, or certification reports.
- `TEST_MODE=true`, a verified test database, and disabled external side effects are the default local posture.
- Mongo transaction/concurrency claims require a replica set and tests at the integration level that can prove them.
- A production dry run, current-payload inspection, provider send, migration apply, or flag enablement always requires separate authorization and exact target verification.

## 11. Migration and index protocol

Every unit says either `none` or names the applicable final-spec Section 34 report → reviewed apply → verify flow.

- Scripts are dry-run/report by default, deterministic, PII-safe, idempotent, and reject unknown or historical databases.
- Production mutation requires the exact `--apply --confirm-production=<database-name>` posture and separate user authorization.
- Unique indexes are created only after a zero-collision report.
- Verify is read-only and exits nonzero on an invariant mismatch.
- Rollback preserves evidence, activation history, committed official facts, canonical revisions, command executions, and entity changes.

## 12. Verification standard

Run focused tests for the unit and the applicable repository-wide commands from final-spec Section 35.2. AC-owned tests include their `AC-xx` identifiers in test names.

Use the test level capable of proving the claim:

- pure unit: normalization, routing, Priority, desired state, fingerprints, schedules;
- model: paths, validators, immutable evidence, index definitions;
- Mongo replica-set integration: transactions, races, revisions, link reservation/correction, outbox atomicity;
- module: processor and reconciliation production interfaces;
- route: auth, Zod, error mapping, envelopes, masking;
- cross-channel: equivalent webhook, extension, and automation outcomes;
- RingCentral integration: adoption, duplicate correctness, leases, cursor;
- Admin component/E2E: filters, blank official inputs, conflict preservation, accessibility, Referral/no-Lead behavior;
- extension: operation identity, retry/auth refresh, response mapping, compile/build.

Staging/live verification starts with redacted synthetic evidence. Production verification remains read-only unless separately approved and inspects causal IDs and bounded metrics rather than raw contact/payload values.

## 13. Completion report

Every completed unit leaves a concise Markdown report containing:

- unit number/title and completion status;
- repositories and branches actually used;
- files added/changed grouped by behavior;
- authoritative final-spec sections, S-slice, invariant numbers, and AC IDs implemented;
- migrations/indexes and report/apply/verify status, including database mode;
- flags before/after and confirmation that later effects remain disabled;
- focused and full commands with exact pass/fail results;
- synthetic/manual/staging verification with only masked identifiers;
- concurrency, idempotency, replay, no-op, privacy, and security assertions proven as applicable;
- known risks, deferred compatibility, contradictions, and the exact units newly unblocked;
- final `git status --short` for each affected repo; and
- an explicit statement that no commit, push, deploy, production mutation, live payload exposure, or external send occurred unless separately authorized.

## 14. Handoff rejection conditions

A unit remains incomplete when any of the following is true:

- required focused or repository checks fail;
- an AC is claimed without a test at the prescribed interface level;
- a persistent change lacks the required migration/report/verify decision;
- an effect lacks Decision/Command/Change/revision/outbox causal proof;
- a no-op creates Change or Sheet work;
- forbidden payload, credential, or PII data appears outside protected evidence;
- a later effect is enabled prematurely;
- an old client path bypasses receipt processing after its cutover unit;
- a concurrency claim is mocked above the level needed to prove Mongo behavior;
- docs and rules contradict runtime behavior;
- the tree contains unexplained overlap; or
- the handoff claims success from prose rather than inspected code and command output.

## 15. Rollout discipline

Preserve final-spec Sections 38–39 ordering. Case reads precede owner commands; Booking precedes Release; Referral follows standard Booking; discrepancies follow both; email is last and optional. Unit 33 proves complete synthetic/redacted production-interface regression. Unit 34 alone uses current Granot webhook payload shapes, under isolation, as final application-logic certification. Unit 34 must introduce no new domain behavior and does not authorize rollout.
