# CSI-01 Step 2 independent review

Reviewer: independent GPT-6 review agent, September 17, 2026. This replaces the proposed Fable review. Review subject: actual uncommitted server patch on `sales-intelligence` after baseline `8219d2ac11c991c69f006e0a705b779548368e72`, including untracked implementation files, and the three limited Admin compatibility changes on `sales-intelligence`.

Final independent disposition: **approved for CSI-01 completion and G1 shared-foundation contract freeze after fixes**. All five substantive findings below are resolved in the reviewed patch. This satisfies the independent code-review gate; it is not a claim that downstream B–E features, deployment capabilities, or full product acceptance are complete. The coordinator owns final contract publication and ledger status. No actual B–E acceptance messages are asserted.

Initial disposition was **changes requested; do not freeze G1 yet**. The implementing agent fixed the findings before re-review. Original findings and reproduction evidence are preserved below.

## Scope and method

Read repository and workspace instructions, Team A assignment, CONTRACTS, Step 2 handoff, domain catalog and relevant September 17 documents 01/02/03/04/06/10/11/12. Reviewed shared validators, model registry and schemas, migration report/apply/verify, existing conversation compatibility, API guard and CSI boundary, actor/run authentication, transactions/CAS/audit, durable jobs, budget and policy. Downstream capture, clocks/effect planning, MCP tool implementation and Owner screens are Teams B–E work, not missing CSI-01 implementation.

Used source inspection and additional synthetic probes against the already running disposable single-node replica `mongodb://127.0.0.1:27189/?replicaSet=csi01`. Each probe explicitly selected `TEST_MODE=true` and a fresh `testvantagemovers_csireview<timestamp>` database. Node used `--import tsx` and stdin programs; no environment file or provider credentials were read. The reviewer did not edit runtime code, production data, branches or original Grok evidence. No deployment, external messages or live provider calls were made.

## Findings from the initial patch

### R1 — P1: static scoped-key configuration cannot authorize generated runs

Location: `src/middleware/requireApiSecret.ts`, `isRouteAllowed` (initial lines 400–406), and `src/routes/sales-intelligence-boundary.routes.test.ts` (initial lines 26–35).

The inherited scoped-key matcher only compares configured path strings with the literal request path. The new CSI hard allowlist narrows that match but never recognizes the documented `/runs/:id/context`, `/read`, `/submit`, or `/submission` templates. Configuring those stable templates therefore denies every actual ObjectId URL with 403. The test bypasses the deployment problem by putting its one literal synthetic run ID into static configuration. This blocks the published run authentication contract as soon as a new run is created.

Required fix: support only the four closed CSI templates for the named CSI key (preserve generic scoped-key semantics), with method checks and valid run IDs. Prove at least two generated run IDs under the same stable configuration and denial of non-CSI paths.

### R2 — P1: strict Owner commands reject required intervention inputs

Location: `src/validation/v1/salesIntelligence.ts`, initial `confirm_run`, `apply_suggestion`, and `reanalyze` alternatives (approximately lines 130–145). Authority: document 04 section 4; document 10 section 7.

`confirm_run` accepts no expected output digest. `apply_suggestion` accepts only `run_id`, rejecting the suggestion digest and supported date/Agent overrides. `reanalyze` accepts only mode/reason, rejecting the source run ID and Owner correction references. In particular, original-evidence analysis cannot select an older source run through this interface. These are strict schemas intended for downstream freeze, so callers cannot supply the specified fields later without breaking the published contract.

Required fix: represent exact digest targets, original source run and correction references, and optional suggestion overrides; discriminate original/current-context requirements and add valid/invalid fixtures.

### R3 — P1: mutable finding/run models can rewrite immutable provenance

Location: `src/models/salesIntelligence/intelligence.ts`, `finalizedFields` (initial lines 102–108) and `IntelligenceFindingSchema`/model (initial lines 252–308). Authority: document 02 sections 7/15/16; document 10 sections 7/8.

Independent replica probe created a valid finding, then called `Model.replaceOne({_id}, {...storedRow, assertion: {...assertion, claim: 'Replaced immutable original assertion'}, key: 'rewritten'})`. It succeeded. Reread output: `FINDING_REPLACEMENT Replaced immutable original assertion`. Mongoose `immutable:true` on the assertion/key is insufficient for replacement. The projection model also has no equivalent replacement/pipeline/bulk/deletion restriction.

A second probe created a finalized completed run and called `updateOne` changing `prompt_version`, `subject_key`, and `input_fingerprint`. It succeeded; reread output: `FINAL_RUN_METADATA rewritten number:other changed`. The protected-field list freezes output/prompt text but leaves their identity and version provenance rewritable.

Required fix: guard original assertions and finalized run provenance across supported Mongoose mutation APIs, while allowing the declared mutable review/status/cost projections. Add replica regression coverage. A separate attempted document `deleteOne()` on the fully append-only assessment model was correctly rejected; that path is **not** a finding.

### R4 — P2: job replay silently returns an unclaimable foreign-deployment job

Location: `src/services/salesIntelligence/jobs.ts`, `enqueueCsiJob` (initial lines 32–56). Authority: document 02 section 17 and published dataset-bound job contract.

The dedupe lookup is global to the database and the replay hash omits deployment/database. Independent probe: enqueue an identical dedupe key/payload under `review-A`, change the deployment ID to `review-B`, enqueue again. Output: `CROSS_DEPLOYMENT_REPLAY true review-A claimable_B false`. Enqueue acknowledges the old job, while claim correctly refuses to process it in B. The triggering transaction can commit without scheduling runnable work.

Required fix: include dataset identity in replay validation and explicitly reject a mismatched stored job (or introduce an intentionally namespaced dedupe/index contract). Prove no successful foreign replay.

### R5 — P2: period initialization does not wake budget-paused jobs

Location: `src/services/salesIntelligence/aiBudget.ts`, `initializeCsiBudgetPeriod` (initial line 149 onward). Authority: document 10 section 8.

Increasing the ceiling resumes budget-paused jobs, but creating the next current budget period only inserts totals. `claimCsiJob` excludes paused jobs, so existing jobs remain paused indefinitely unless another integration performs an undocumented resume. The shared initializer is the concrete boundary published to the calendar consumer.

Required fix: initialize/admit the active period and resume eligible current-dataset budget pauses atomically, without waking jobs for a future or exhausted period, or publish an explicit reusable resume contract and downstream obligation. Calendar boundary calculation remains Team C work.

## Nonblocking observations and boundary limits

- `requireCsiRun` initially loaded its referenced job by ID/status without explicitly matching the job's subject/dataset, unlike token issuance. The implementer was asked to keep verification equally fail-closed; a signed token is still required, so this is not claimed as an independently exploitable auth bypass.
- Assessment `finding_ids` can link to findings containing evidence; absence of an inline duplicate evidence array is not by itself a blocker. Consumers must resolve those references.
- The limited Admin nullability and duration presentation changes are consistent with unknown metadata; no substantive issue found in those three files.
- New model/index inventory, nullable multiple follow-ups, transactional command/lease boundaries and account migration strategy were substantively examined. Existing passing suites do not negate the specific failures above. No production-account attribution or provider capability conclusion is made.

## Re-review

Completed September 17, 2026 against the actual revised uncommitted files, after the implementing agent reported runtime fixes stable. No outstanding substantive CSI-01 findings remain. Freeze readiness is approved for the published foundation interface; G2–G6 remain outside this approval. The implementer subsequently confirmed server typecheck exit 0 and report/verify exit 0 on its separate synthetic regression database.

| Finding | Independent disposition | Evidence |
| --- | --- | --- |
| R1 | Resolved | The named CSI key now uses closed `:id` templates in the actual v1 matcher. Generic keys keep literal matching. Reviewed the wired matcher, all four method/path templates, and HTTP coverage using two distinct generated run IDs. |
| R2 | Resolved | Commands now carry exact output/suggestion digests, suggestion overrides, source run ID and correction refs; original-evidence mode requires a source run. Strict positive/negative schema tests pass. |
| R3 | Resolved | Run provenance is included in finalization guards; renames/pipelines/replacement/bulk/deletion are blocked where required. Finding updates allow only review projection fields. Independent original exploit replay rejects replacement/pipelines and preserves finalized provenance while permitting a review-state/revision update. |
| R4 | Resolved | Enqueue hashes and verifies deployment/database identity. Independent original replay now raises `IDEMPOTENCY_CONFLICT`. |
| R5 | Resolved | Active-period activation and current-dataset budget-job resume share one transaction and a once-only activation stamp. Future periods and permission/foreign-dataset pauses remain untouched. Independent active-period probe confirms work becomes pending. |

Stored run verification additionally checks referenced job subject/deployment/database; replica tests demonstrate denial for mismatches and stale epochs. This closes the nonblocking hardening observation above.

Commands independently run by the reviewer after the fixes:

```text
node --import tsx --import ./ops/test-setup.ts --test src/routes/sales-intelligence-boundary.routes.test.ts src/services/salesIntelligence/foundation.test.ts
Result: 9 tests passed, 0 failed.

pnpm test:csi:replica
Result: 15 tests passed, 0 failed (outer test plus 14 replica subtests).
Database: testvantagemovers_csif7eb540c8070; loopback csi01 port 27189.

Independent stdin Node/tsx adversarial probe, fresh isolated test database:
R3 finding rewrite rejected; review projection allowed
R3 finalized run provenance preserved
R4 foreign replay rejected
R5 active budget period resumed pending work
Exit code: 0.
```

The adversarial recheck asserted failure of the original finding replacement and an update pipeline, verified a legal review projection update, asserted zero modifications for finalized prompt-version/subject/fingerprint changes, asserted a cross-deployment enqueue conflict, and verified a current-period initializer resumes a paused budget job. This is additional evidence beyond rerunning the implementer's suite. The broader focused suite/typechecks remain recorded by the implementing agent in the final checks artifact; they are not mislabeled as independent executions here.

Reviewed runtime file SHA-256 fingerprints (server-relative):

```text
A4D19C16625EEF684BFA97A1ADF6565AF5AB16D048528356B16F593213D4F400 src/config/domain/salesIntelligence.ts
F778D7CEE1472BE55F96268758320F28E682AC64043D6051072F9911A55F41AC src/middleware/requireApiSecret.ts
57416D34294DB56DE793AAD81DE278BDBDB1FB71F5817AB7732FC268A4B7F02C src/models/salesIntelligence/intelligence.ts
02BCD7235D6BEF5A8C5A0AEFD2B20D31FD147FEC9FEEA7BE851E107BA3085770 src/services/salesIntelligence/jobs.ts
ABA6E400DD0BF55E7D1B2B1C4B9247EDBCC5F110B8424E7D178DA2ECDACE1547 src/services/salesIntelligence/aiBudget.ts
A3ED7B61AB324FB2C37023FB9726CB4F4F0A2A5585E112ADADAE4480FC5488D0 src/services/salesIntelligence/auth.ts
E254574E0390BF5159496E3A2D998F24D7DE49EDAF3C472081E156847C32A206 src/validation/v1/salesIntelligence.ts
```

Remaining handoff limitations: downstream handlers must enforce semantic revisions/chronology, use transaction sessions, construct trusted evidence manifests and reserve before provider calls. The old one-off `seed-known-conversation` operator script still uses global recording identity; document that it must not be rerun after account-scoped ingestion without an account-aware adaptation. This review does not authorize that script or any production mutation. No claim of B–E consumer acceptance or provider readiness is made.
