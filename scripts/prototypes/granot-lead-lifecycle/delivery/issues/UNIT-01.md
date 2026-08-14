# Unit 01 — Contract freeze, redacted synthetic fixtures, and quality guardrails

> **Contract maturity: implementation-ready.** This is the only unit currently ready to start. It establishes compile-time and test-fixture contracts; it does not implement receipt persistence, normalization runtime behavior, matching, processing, or effects.

## 1. Authority and required reading

- **Final specification:** Sections 1–2, 4–7, 10, 35–36, 37.2, and 38/S01.
- **Original slice:** S01 — Freeze contracts and redacted fixtures.
- **Acceptance ownership:** AC-03; normalization-fixture portions of AC-05 and AC-06; source/provider-context fixture portion of AC-29.
- **Canonical language:** workspace-root `CONTEXT.md`.
- **Execution rules:** `scripts/prototypes/granot-lead-lifecycle/delivery/AGENT-EXECUTION-RUNBOOK.md`.
- **Optional extraction protocol:** `.cursor/agents/lead-lifecycle-spec-extractor.md`.
- **Repository guidance:** `AGENTS.md`, `CLOUD_AGENTS.md`, `.cursor/rules/lead-lifecycle-delivery.mdc`, and applicable TypeScript, testing, backend-safety, project-organization, business-logic, owner-workflow, and Form Lead CRM rules.

The final specification wins on conflict. Do not use prototype Intake names, prototype enums, or older lifecycle specs to fill gaps.

## 2. Objective

Leave `vantage-main-server` with one authoritative shared Granot lifecycle vocabulary, a strict Zod contract for redacted cross-channel normalization fixtures, a sufficient synthetic fixture matrix for the assigned AC portions, an executable fixture secret/PII scanner, and corrected active documentation for the `FormLead.ref_no → Granot leadno/ref_no` identity contract.

At handoff, a later unit must be able to import the exact shared vocabulary and consume the fixtures as executable contracts without copying prototype types or handling customer data. Unit 04 will implement the production normalizer against these frozen fixtures.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server` only.
- **Required branch:** `granot-lead-lifecycle`.
- **Prerequisites:** none.
- **Before editing:** run `git status --short`, `git branch --show-current`, and inspect recent changes in the affected services/rules.
- The untracked `.cursor/agents/lead-lifecycle-spec-extractor.md` is user-owned input. Read/reference it; do not rewrite or absorb it into this unit.
- Do not commit, push, deploy, mutate a database, call Granot, send external messages, or inspect current customer payloads.

## 4. Current-state evidence to verify

The issue author observed the following on 2026-08-14. The implementing agent must recheck it rather than treating it as durable proof:

- `src/services/crm/formLeadPayload.ts` currently maps persisted `FormLead.ref_no` to CRM payload `leadno` and treats the `not provided` sentinel as blank.
- `src/services/crm/formLeadPayload.test.ts` already tests provider-reference posting and log-safe fingerprinting, but the applicable test names do not carry `AC-03`.
- `src/services/granotHttpCollector/formWorkflow.test.ts` already tests exact `FormLead.ref_no` matching before Mongo `_id` compatibility fallback.
- `.cursor/rules/form-lead-granot-crm.mdc` describes the final-spec identity contract correctly.
- `.cursor/rules/owner-lead-workflow.mdc`, `.cursor/rules/business-logic.mdc`, `.cursor/businesslogic/form-lead.service.md`, and parts of `docs/showcase/` contain stale claims that Mongo `_id` is the value posted as `leadno`.
- `docs/granot-webhook-domain-service-model.md` records the old contradiction rather than the now-locked final decision.
- No production `src/services/granotLifecycle/` shared-contract module or production normalization fixture package was found.

If current code no longer matches the first three observations, report the contradiction before changing behavior. Unit 01 may fix a narrow contract regression already covered by AC-03, but it must not redesign CRM Posting or implement later lifecycle processing.

## 5. Locked decisions and invariants at risk

### Locked decisions

- `FormLead.ref_no` is posted to Granot as `leadno`; Granot exposes it as `ref_no`.
- A valid Mongo ObjectId-shaped Granot `ref_no` remains a secondary compatibility identity after exact `FormLead.ref_no` lookup misses.
- All valid Priority values are retained as evidence; only `1` and `5` later authorize broad enrichment and set `quoted = true`; no Priority value sets it false.
- `Booked`, `Releas`, and `Release` fixture inputs represent repeatable Booking Action evidence. They are not Vantage state transitions. `Released` is unsupported.
- Paid Overflow and a future real source named Auto remain deferred/evidence-only. Payload `type=AUTO` is provider context and cannot classify or reroute the source.

### Applicable Section 4 invariants

- **Invariant 2:** a Granot Observation is evidence, not authority for Booking or Cancellation facts. Fixtures must not encode automatic official mutations.
- **Invariant 3:** Lead Lifecycle is composed from current facts; do not add a stored lifecycle-status enum to the shared vocabulary.
- **Invariant 8:** Source System, Observation Channel, Ingestion Origin, actor, and initiator are separate axes. Fixture inputs must not collapse them.
- **Invariant 9:** immutable creation/submission evidence is never overwritten. Fixtures must distinguish observed/current fields from original evidence.
- **Invariant 10:** identity conflict never reassigns Source Company, Source Granularity, Ingestion Origin, or CPL. Provider `type` must not masquerade as source identity.

Invariants 1 and 4–7, 11–12 remain inherited but this unit creates no persistence or effects capable of exercising them.

## 6. Deliverables

### 6.1 Exact shared TypeScript vocabulary

Create the focused shared types module required by final-spec Section 7 under `src/services/granotLifecycle/`. It must export the exact union names and exact members specified there:

- `ObservationChannel`
- `GranotRouteEventClass`
- `ChannelOperationKind`
- `GranotObservationKind`
- `ReceiptWorkState`
- `NormalizationResult`
- `NormalizationIssueCode`
- `SynchronizationOutcome`
- `SynchronizationReasonCode`
- `ExecutionMode`
- `GranotBookingAction`
- `LeadModel`
- `EntityRef`
- `GranotLifecycleDisposition`
- `GranotLeadCreatedPolicy`
- `GranotDiscrepancyReasonCode`

Do not add aliases, Intake names, a generic lifecycle status, prototype outcome strings, or speculative members. Do not create persistence models or Mongoose sub-schemas in this unit; those belong to later units even though Section 7 identifies their eventual location.

Add type-level or compile-time coverage sufficient to prevent accidental widening of these frozen unions. Follow strict TypeScript rules; do not use `any`, unsafe double casts, or `@ts-ignore`.

### 6.2 Zod normalization-fixture contract

Create a focused fixture contract in the Granot lifecycle test-support boundary. File names may follow the existing repository convention, but the production service must not import test fixtures.

Each fixture must validate at least:

- `schema_version: 1`;
- a stable synthetic `fixture_id`;
- one or more `acceptance_ids` matching `AC-xx`;
- `channel` using the exact `ObservationChannel` union;
- channel context:
  - webhook fixtures identify a `GranotRouteEventClass`;
  - extension/automation fixtures identify a `ChannelOperationKind` and a stable synthetic operation identity;
- a JSON-safe synthetic input payload or statement;
- expected normalization facts limited to the Section 10 contract, including applicable Observation kind/result, issue codes, raw/canonical Priority, normalized Booking Action, source label, identity fields, and `provider_context.type_raw`; and
- an explicit list of forbidden inferences where the fixture is designed to prove that evidence must not become source classification, lifecycle state, or an official Booking/Cancellation fact.

Use a discriminated union or equivalent `superRefine` rules so invalid channel combinations fail validation. In particular:

- a webhook fixture cannot rely on extension/automation operation kind as its route authority;
- extension/automation fixtures require an operation kind;
- `lead_snapshot_apply` fixtures cannot encode a Booked/Release action as authorized input;
- `booking_action_apply` fixtures require a supported Booking Action expectation; and
- every fixture must carry at least one applicable AC ID.

The fixture contract is test support. It must not become a second production payload schema or pre-decide receipt persistence owned by Unit 02.

### 6.3 Redacted synthetic fixture matrix

Add small, composable fixtures for all three channels: `granot_webhook`, `browser_extension`, and `granot_http_automation`. Prefer structural builders plus decision-rich cases over copied full payloads.

The matrix must cover:

1. **AC-03 identity**
   - a synthetic provider Tracking Reference posted as `leadno` and returned as Granot `ref_no`;
   - exact `FormLead.ref_no` match wins;
   - ObjectId-shaped `ref_no` remains a fallback only after exact lookup misses;
   - blank/`not provided` values do not become exact identity.
2. **AC-05 Priority normalization**
   - JSON/string forms as applicable for `0`, `1`, `5`, `8`, `05`, and a 12-digit allowed value;
   - expected canonical values, including `05 → 5` and all-zero → `0`;
   - fixture metadata must not claim that values other than `1`/`5` authorize broad enrichment.
3. **AC-06 malformed/missing Priority**
   - Priority Update becomes `invalid` with no independent action;
   - equivalent malformed Priority on Lead Created, Booked, and Release is `valid_with_issues`, skips Priority, and retains the independent action expectation.
4. **Booking Action vocabulary supporting Unit 04**
   - case-insensitive exact `Booked → booked`;
   - exact `Releas` and `Release → release`;
   - `Released → unsupported`, never prefix-inferred.
5. **AC-29 source/provider separation**
   - Paid Overflow source evidence remains deferred/evidence-only;
   - source label Auto remains deferred/evidence-only if represented;
   - payload `type=AUTO` remains only `provider_context.type_raw` and never replaces the source label or selects Source Scope.
6. **Cross-channel parity seed**
   - equivalent synthetic Lead statement shapes for webhook, extension, and automation with matching expected normalized facts;
   - equivalent supported Booking Action statement shapes where each channel contract permits them.

Use obviously synthetic values only. Safe examples include names such as `Synthetic Customer`, emails under `example.invalid`, and NANP-reserved `202-555-01xx` numbers. Do not include real street addresses, current payload fragments, credentials, cookies, authorization values, source IDs guessed from production, or customer-like free text.

### 6.4 Executable fixture secret/PII scanner

Add an automated test or deterministic test helper that recursively scans every lifecycle fixture and fails with the fixture ID and safe field path—not the sensitive value—when it finds prohibited material.

At minimum detect:

- credential/header keys such as `authorization`, `cookie`, `set-cookie`, `x-api-secret`, webhook secret/password/token fields, and case/underscore/hyphen variants;
- bearer/basic credentials, JWT-like values, private-key markers, long opaque secret-like values in credential-shaped fields, and URL credentials;
- email addresses outside the reserved synthetic domain allowlist;
- phone-like values outside the documented reserved synthetic range;
- realistic street-address patterns or fixture names outside the documented synthetic allowlist;
- raw payload files or durable fixture sources not validated by the fixture schema; and
- accidental inclusion of known current-payload/customer fixture directories if such paths exist locally.

The scanner may allowlist narrowly documented reserved examples. Do not weaken it with a broad directory, key, or regex exclusion. Failure output must remain PII-safe.

### 6.5 AC-ID test naming

All new or touched tests owned by this unit must include the applicable IDs in their test names, such as `[AC-03]`, `[AC-05]`, `[AC-06]`, and `[AC-29]`.

Update the existing CRM payload and Form matching contract tests so AC-03 is visible at the production boundaries already proving it. Do not mechanically tag unrelated tests.

### 6.6 Documentation drift correction

Correct `.cursor/rules/owner-lead-workflow.mdc` so it says:

- CRM Posting sends persisted `FormLead.ref_no` as `leadno`;
- Granot exposes that value as `ref_no`;
- exact `FormLead.ref_no` is the primary identity; and
- Mongo `_id` is a compatibility fallback, not the current posting contract.

Run a repository search for the same stale claim. Correct or explicitly mark superseded active guidance that still tells an agent/operator that CRM Posting sends Mongo `_id`, including the currently observed conflicts in `.cursor/rules/business-logic.mdc`, `.cursor/businesslogic/form-lead.service.md`, `docs/showcase/owner-workflow.md`, `docs/showcase/presentation-test-values.md`, and the resolved-contradiction note in `docs/granot-webhook-domain-service-model.md` where applicable.

Keep corrections narrow: do not rewrite unrelated Booking/Cancellation workflows, remove valid Mongo-ID booking inputs, or remove the historical compatibility lookup. If a stale document is intentionally historical rather than active guidance, label the superseded identity statement clearly instead of silently changing history.

## 7. Explicitly out of scope

- `GranotObservationReceipt`, `GranotObservation`, or any other Mongoose model/schema/index.
- Webhook authentication/capture changes, credential stripping, hashing, response behavior, or queue publishing.
- Production normalization implementation; Unit 04 consumes the fixture contract.
- Registry persistence, source classification implementation, identity matching changes, desired-state planning, processor orchestration, retries, activation, flags, commands, cases, discrepancies, Admin UI, extension changes, or automation cutover.
- Any Lead, Booking, Cancellation, Sheet Sync, notification, or external effect.
- Adding optional hooks if doing so delays the contracts/tests. Any hook added must be local, advisory, deterministic where possible, non-mutating, and covered by the same PII-safe output rule.

## 8. Flags and runtime posture

- **Starting flags:** none introduced or changed by this unit.
- **Ending flags:** none introduced or changed by this unit.
- Do not add the final Section 27 flag module early merely to prepare later work.
- No runtime lifecycle processing or persistence is enabled.

## 9. Migration and indexes

**None.** This unit performs no persistent-data or index change and runs no migration command.

## 10. Acceptance criteria

- [ ] **AC-03:** Form CRM Posting sends `FormLead.ref_no` as `leadno`; Granot `ref_no` round-trips to the exact Form Lead; valid Mongo ID fallback remains compatible.
- [ ] AC-03 is proven at the existing CRM payload boundary and Form matching boundary with `[AC-03]` test names.
- [ ] **AC-05 fixture ownership:** valid Priority `0`, `1`, `5`, `8`, `05`, and a large allowed value have schema-valid synthetic cases with exact raw/canonical expectations; fixtures do not imply that a non-`1`/`5` value broadly enriches or sets Quoted false.
- [ ] **AC-06 fixture ownership:** missing/malformed Priority distinguishes invalid Priority Update from `valid_with_issues` independent Lead Created/Booked/Release behavior.
- [ ] **AC-29 fixture ownership:** Paid Overflow/Auto evidence remains distinct from provider `type=AUTO`; fixtures explicitly forbid `type`-driven source reclassification.
- [ ] Shared unions exactly match final-spec Section 7 and reject removed/prototype/Intake vocabulary at compile time or focused tests.
- [ ] The strict Zod fixture contract accepts every committed lifecycle fixture and rejects invalid channel/operation/AC metadata combinations.
- [ ] Fixtures cover webhook, extension, and automation inputs without claiming final channel adapters already exist.
- [ ] The scanner inspects all committed lifecycle fixtures and fails safely for injected credential, non-reserved email/phone, realistic address, and secret-like sentinel cases.
- [ ] No committed fixture contains customer PII, credentials, authorization/cookies, current payload fragments, or live database output.
- [ ] Active owner/agent guidance no longer says Mongo `_id` is the current `leadno` posting value; compatibility fallback remains documented.
- [ ] No runtime persistence, effects, flags, migrations, or indexes are introduced.

## 11. Required tests and commands

Map the acceptance bullets to focused tests before implementation. At minimum run:

```text
node --import tsx --import ./scripts/test-setup.ts --test "src/services/granotLifecycle/*.test.ts" "src/services/crm/formLeadPayload.test.ts" "src/services/granotHttpCollector/formWorkflow.test.ts"
pnpm test
pnpm typecheck
```

Adjust only the focused glob if the test-support files use a nested directory. The full commands are mandatory because shared unions and documentation-aligned contract tests affect later units.

Test the scanner itself with synthetic in-memory bad cases. Do not add prohibited examples as committed fixture files merely to prove rejection.

## 12. Live/staging verification

No live or staging service call is required. Verification is local and read-only:

- parse every synthetic fixture through the Zod fixture schema;
- run the secret/PII scanner over the full fixture set;
- inspect a bounded fixture inventory by fixture ID/channel/AC only; and
- verify repository search results for stale `leadno` identity guidance.

Do not print payload bodies or contact values during verification.

## 13. Rollback

Documentation/test/type-support-only revert. There are no data, index, activation, flag, or external effects to reverse. If later units already import the frozen types/fixtures, coordinate rollback rather than deleting their dependency blindly.

## 14. Required completion handoff

Use Runbook Section 13 and include, specifically:

- the exact shared types exported and confirmation they match Section 7;
- fixture IDs grouped by channel and AC, without payload bodies;
- scanner rules and allowlists, plus safe rejection-test results;
- every stale identity document found and how it was corrected or marked superseded;
- focused/full command outcomes and test counts;
- confirmation of no models, indexes, migrations, flags, runtime persistence, external calls, or customer/current payload use;
- final `git status --short`; and
- the statement that successful Unit 01 verification unblocks contract refinement for Units 02, 05, and 09.

Do not mark Unit 01 complete if any Section 10 checkbox is unproven, a required command fails, or active guidance still contradicts AC-03.
