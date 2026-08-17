# Granot Lead Lifecycle — final specification to 34-issue traceability

**Prepared:** 2026-08-17  
**Purpose:** show exactly how the approved final specification is delivered by Units 01–34, why the dependency order is correct, and what evidence must exist before the program advances.

## 1. Confirmation

The 34-unit delivery map is a faithful decomposition of the final specification.

- All 41 final-spec sections are assigned either to a concrete implementation unit, a cross-cutting unit contract, or a final certification unit.
- All acceptance scenarios AC-01 through AC-40 have named unit owners and a prescribed final proof boundary.
- The sequence preserves the specification's fixed rollout rule: capture evidence safely first; reason in shadow before writing; enable matched-Lead writes before Lead creation; prove RingCentral convergence before increasing cadence; expose reconciliation read-only before enabling Owner commands; clean up compatibility only after full regression; and replay current webhook shapes only against the completed system.
- The split from 23 specification slices to 34 delivery units does not change product meaning. It separates migrations from runtime behavior, read paths from mutations, and foundations from effect enablement so each handoff can be verified independently.
- Unit 34 is correctly outside the original S01–S23 slice list. It is a final, non-design certification of the completed application logic using current Granot webhook payload shapes.

This is a **traceability confirmation**, not a claim that all 34 issue contracts are currently implementation-ready. As of this review, Units 01 and 02 are complete; Units 03–34 are scaffolded in the delivery pack and must be refined against landed repository state before implementation. The status ledger remains the operational source for readiness.

## 2. Authority and interpretation

Use these sources in this order:

1. [`FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md`](FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md) — implementation contract; wins on conflict.
2. [`FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE-INDEX.md`](FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE-INDEX.md) — reading router; it does not redefine behavior.
3. [`lead_lifecycle_issue_breakdown_reccomendation.md`](lead_lifecycle_issue_breakdown_reccomendation.md) — approved 34-unit spine, dependencies, AC ownership, and handoff rules.
4. [`../delivery/README.md`](../delivery/README.md), [`../delivery/AGENT-EXECUTION-RUNBOOK.md`](../delivery/AGENT-EXECUTION-RUNBOOK.md), and [`../delivery/UNIT-STATUS.md`](../delivery/UNIT-STATUS.md) — execution protocol and current readiness.
5. [`../delivery/issues/`](../delivery/issues/) — the individual implementation contracts after each scaffold is refined.

Every unit also inherits final-spec Sections 1–7: authority, scope, repository contract, invariants, language, architecture, and shared contracts. A narrow section citation in an issue never relaxes those program-wide rules.

The mapping below uses four kinds of ownership:

- **Foundation:** establishes schema, vocabulary, migration, or reusable command machinery.
- **Behavior:** implements the specified domain or interface behavior.
- **Effect gate:** is the first unit permitted to enable a real mutation or workflow.
- **Certification:** proves already-defined behavior without inventing new behavior.

## 3. Why the sequence is correct

The unit numbers express a dependency-aware rollout, not merely a convenient reading order.

```text
Evidence safety
01 -> 02 -> 03 -> 04
      vocabulary, immutable receipt, authenticated capture, normalization

Policy and durable execution foundations
01 -> 05 -> 06 --------------------------+
01 -> 09 -> 10 -> 11 -> 12 -> 13 -------+--> 14 -> 15
04 -> 07 -> 08 ---------------------------+    identity + shadow processor

Channel convergence before effects
15 -> 16 (extension shadow) ----+
15 -> 17 (automation shadow) ---+--> parity approval -> 18 -> 19
                                              matched writes   creation

Dependent workflows
19 -> 20 -> 21                    RingCentral adoption, then faster cadence
18 -> 22 -> 23 -> 24 -> 25       Booking read-only, then Owner commands
22 -> 23 -> 26 -> 27             Release read-only, then Owner commands
24 + 25 -> 28                    Referral workflow
24..27 -> 29                     discrepancies and link correction

Program closure
01..29 -> 30 -> 31 -> [32 optional] -> 33 -> 34
          operations  certification   cleanup  current-payload go/no-go
```

The reasoning behind the major gates is:

1. **Evidence precedes interpretation (Units 01–04).** Authentication, credential removal, immutable capture, hashing, and normalization must be correct before payloads can influence identity or business state. Otherwise later fixes would be unable to distinguish bad evidence from bad processing.
2. **Policy and transaction safety precede writes (Units 05–15).** Source policy, revisions, canonical transactions, provenance, identity ladders, temporal ordering, retries, and shadow Decisions are built while effect flags remain off. This makes unsafe writes structurally impossible during foundation work.
3. **All channels converge before the first live Lead effect (Units 16–18).** Webhook, extension, and automation inputs must yield equivalent receipt/observation/decision behavior in shadow. Unit 18 is therefore gated by a reviewed parity report, not only by code completion.
4. **Enrichment precedes creation (Units 18–19).** Updating a confidently matched Lead exercises authority, idempotency, causal provenance, and Record Link behavior with less risk than creating a new aggregate. Creation is enabled source by source only after matched writes are proven.
5. **RingCentral safety precedes cadence (Units 20–21).** Adoption and duplicate correctness are proven at the existing cadence. The cron moves to every 30 minutes only after leases, overlap recovery, cursors, lookback, and telemetry are demonstrated.
6. **Read-only reconciliation precedes Owner mutations (Units 22–27).** Case identity, sequencing, evidence refresh, projections, masking, and UI comprehension are reviewed first. Booking and Cancellation commands are added only after humans can inspect the exact cases they will resolve.
7. **Normal workflows precede exception workflows (Units 28–29).** Referral and discrepancy handling reuse validated Booking/Release command and projection seams instead of creating parallel mutation paths.
8. **Operational proof precedes cleanup (Units 30–33).** Metrics, health, migrations, shadow certification, security audits, rollback artifacts, and complete synthetic regression must exist before compatibility paths and prototype code disappear.
9. **Current payloads certify; they do not design (Unit 34).** Real current payload shapes are held until the application logic is complete, isolated, and regression-green. Any mismatch returns to the owning earlier contract as a defect; Unit 34 must not weaken normalization, identity, source policy, or invariants to make a payload pass.

## 4. Unit-by-unit traceability

The “exit proof” column states what must be true before the unit can be treated as a valid predecessor. Completion reports alone are not proof; repository state, migrations/indexes, flags, and test output must be rechecked.

| Unit | Final-spec mapping | AC ownership | Delivered boundary and exit proof | Why it occurs here |
| --- | --- | --- | --- | --- |
| **01 — Contract freeze and fixtures** | §§4–7, 10, 35–36, 37.2; S01 | AC-03; fixture portions of AC-05, AC-06, AC-29 | Exact shared vocabulary; strict fixture schema; redacted webhook/extension/automation fixtures; secret/PII scanner; corrected `FormLead.ref_no -> leadno` docs. No persistence effects. | Every later unit needs one vocabulary and safe executable evidence before it can create models or behavior. |
| **02 — Channel-neutral receipt and migration** | §§9.1, 9.4, 34.1, 34.5, 34.7; first half S02 | AC-02 foundation; AC-35 receipt/migration privacy | Evolve the existing collection in place; immutable evidence and mutable work state; canonical hash; indexes; report/apply/verify migration; compatibility alias. Processing remains off. | Safe durable evidence must exist before the webhook route or processor can be changed. |
| **03 — Authenticated webhook capture** | §§9.2–9.3, 28.1, 33; second half S02 | AC-01; webhook AC-02; capture AC-35 | Timing-safe header/body authentication; delete credentials before downstream handling; header allowlist; capture-before-202; safe errors; receipt-ID-only wake-up. | Builds on the receipt contract and closes the security boundary before normalization starts. |
| **04 — Observation normalization** | §§7, 10; S03 | AC-05, AC-06; aliases used by AC-25, AC-29 | Exactly one Observation per receipt; exact scalar/source/identity/contact/move/Priority/money/Agent/Booking Action rules; explicit invalid/unsupported results. No aggregate mutation. | Policy and identity must consume normalized facts, never raw channel-specific payloads. |
| **05 — Source Registry domain** | §§8.1, 8.4, 23 provenance; server part S04 | AC-04, AC-09, AC-29, AC-38 | Semantic source authority; strict validation; audited commands in one transaction; post-commit cache invalidation; layered fail-closed effect gates. All lifecycle rows disabled/deferred. | Identity cannot be evaluated safely until Source Scope and policy are authoritative. This track can begin after Unit 01. |
| **06 — Registry migration and reviewed UI** | §§8.2–8.3, 29, 34.2; remainder S04 | AC-09, AC-29, AC-38 | Exact-normalized inventory/join; automation reference; locked classifications; unmatched/ambiguous report; audited minimum UI; PII-safe migration. `lead_created_policy` remains `link_only`. | Runtime policy must be backed by reviewed data before Decisions, identity, or creation use it. |
| **07 — Decision, activation, and Record Link skeleton** | §§11, 13, 27.1, 28.2, 33; S05 | AC-02 decision evidence; AC-31; parts of AC-32, AC-35 | Decision, activation, and Record Link models/indexes; historical/live-shadow/live classification; safe projections and activation command. Mutation/case flags remain off. | Normalized evidence and Registry policy are required to record explainable decisions safely. |
| **08 — Durable drainer and retries** | §§26, 28.3 requeue, 33; S06 | AC-30, AC-37 | Fenced leases, renew/recover, queue and five-minute cron, retry schedules, pending-match clock, dead letter, audited requeue, safe metrics. Processor stays shadow-only. | Mongo-backed work execution must be reliable before the processor becomes the shared runtime path. |
| **09 — Aggregate revisions and migration** | §§14.1, 23.2 CAS, 34.3–34.5; foundation of S07/S08 | Prerequisites for AC-21, AC-32 | Revisions/history boundaries for Leads, Booking, Cancellation; idempotent backfills; index collision report; no fabricated history. | Revision guards are required before canonical transaction code can prevent stale writes. This track can begin after Unit 01. |
| **10 — Canonical command executor** | §§23.1–23.2, 24 common envelope; core S07 | AC-21, AC-32 foundation | One transaction owned by the executor; session/clock injection; validated provenance; causal IDs; replayable results; checksum conflicts; CAS race proof. | All later mutations need a single atomic and idempotent command seam. |
| **11 — Entity Change and outbox atomicity** | §§23.2–23.4, 35.1; remainder S07 | AC-21, AC-32 foundation | Command/change/revision/outbox causal chain; privacy policy; canonical existing write adapters; no external call before commit; no Change/outbox on no-op. | Canonical execution is incomplete until audit and downstream intent share its transaction. |
| **12 — Lead provenance schema parity** | §§14.2–14.4, 15; runtime half S08 | Foundations for AC-03, AC-07, AC-10–12 | Immutable Ingestion Origin and snapshots; Form/Call parity; normalized Job/Priority/Granot fields; convergence state; creation-path capture; trusted validators; public/admin exclusions. | Identity and authority planning need honest creation evidence and equivalent Lead schemas. |
| **13 — Provenance/index migration** | §§14, 34.3, 34.5; migration half S08 | Migration foundations for AC-10–12 | Deterministic or unknown origin report; normalized Job backfill; honest legacy baselines; collision inventory; indexes; PII-safe verify commands. | Existing records must satisfy the new provenance assumptions before identity ladders run over them. |
| **14 — Source-scoped identity** | §§8.4, 12–13, 15.4, 16 identity; first half S09 | AC-03, AC-04, AC-07, AC-09, AC-13, AC-29, AC-39 foundation | Policy-before-identity; Form/Call ladders; exact and Record Link lookup; Bad/Duplicate rules; source-scoped contact matching; Agent matching; Booking identity context. Candidates only. | Joins normalized facts, reviewed policy, links, and migrated provenance without authorizing effects. |
| **15 — Temporal planner and shadow processor** | §§11, 15–16, 25, 27; second half S09 | AC-05–13, AC-30–32 in shadow | Field authority; temporal winner/tie-break; desired state/no-op; pending schedule; gate snapshots; channel-neutral historical/live-shadow orchestration; zero forbidden effects. | The complete business decision is proven before any channel or effect is switched over. |
| **16 — Browser extension convergence 0.2.8** | §§9 operation identity, 28.1, 30; S10 | extension portions AC-02, AC-33, AC-34 | Receipt-based full-statement apply; stable UUIDs; bounded pending storage; preserved initiator; read-only preview; no authoritative client patch; version/build proof. Shadow only. | The extension must agree with the processor before matched Lead writes can go live. |
| **17 — HTTP automation convergence** | §§28.1, 31; S11 | automation portions AC-02, AC-33 | `${run_id}:${action_id}` identity; locked-plan statement; Owner initiator; lifecycle references/outcome; resumable lease yield; exact replay/conflict; no bypass. Shadow only. | Completes the third channel and creates the parity evidence required by Unit 18. |
| **18 — Matched-Lead effects** | §§11, 13, 15–16.1, 23.4, 27.2; S12 | AC-05, AC-07, AC-10–13, AC-32, AC-33 | Canonical synchronization; atomic Record Link establish/confirm; authorized mutation; Entity Change and Sheet intent; idempotency/no-op/race proof. Enable one reviewed source only after parity approval. | This is the lowest-risk live effect and validates the entire causal chain before creation or cases. |
| **19 — Authorized Lead creation** | §§16.2–16.3, 17 creation seam, 23.4, 27.2; S13 | AC-07–09 | Canonical Form/Call creation; full ladder before create; minimum data/route checks; atomic link reservation; sparse Call safety; concurrency proof. Enable `create_if_missing` source by source. | Creation is irreversible business state, so it follows proven matched synchronization. |
| **20 — RingCentral convergence** | §17; first half S14 | AC-14–16 | Shared adoption service; adoption-before-duplicate ordering; exact criteria; atomic verified metadata and ledger; durable pending/adopted/conflict results; no false duplicate. | Adoption depends on safe Granot-created Lead behavior and provenance parity. |
| **21 — RingCentral lease and 30-minute cadence** | §§17, 33, 39; second half S14 | AC-17 | Renewable lease; one winner; success-only cursor; lookback and telemetry; overlap/recovery proof; only then change cron to `*/30 * * * *`. | Frequency increases only after correctness and overlap safety are demonstrated. |
| **22 — Booking Reconciliation domain, read-only** | §§18–19, 21; server half S15 | AC-18–20, AC-36, AC-39, AC-40 foundation | Case model/uniqueness/sequence; create-missing vs review-existing; Priority-5 distinction; refresh/revisions; safe candidates; discrepancy routing seams. No Booking mutation. | Reconciliation facts and concurrency must be stable before UI or Owner commands. |
| **23 — Booking reads and Admin workflow** | §§28.2, 29; API/Admin half S15 | AC-18–20, AC-35, AC-36, AC-39, AC-40 read proof | Masked cursor APIs; queue/detail; Job and Lead timelines; URL filters; evidence/current-state separation; candidate browser; accessibility and query invalidation foundation. | Owners review the read model before the system offers mutating actions. |
| **24 — Confirm missing standard Booking** | §§23–24.2 create path, 28.3, 29; first half S16 | AC-20–23, AC-32 | Strict idempotent Owner envelope; explicit eligible Lead; current catalog and cents validation; blank official form; atomic Booking/link/case/change/outbox chain; conflict preservation. | First Booking command follows both canonical transaction proof and Owner acceptance of read-only cases. |
| **25 — Booking update and No Action** | §§24.2, 24.5, 28.3, 29; remainder S16 | AC-20, AC-21, AC-24, AC-32 | Full official replacement update; expected revisions; no identity change/second Booking; No Action command with no aggregate Change/outbox; UI conflict preservation. | Reuses the validated standard Booking command/UI seam and completes Booking resolution choices. |
| **26 — Release Reconciliation, read-only** | §§18, 20–21, 28.2, 29; S17 | AC-25–27, AC-35, AC-36, AC-40 read proof | Release case/sequence; deterministic active Booking projection; already-cancelled behavior; discrepancy routing; masked API/UI/timeline. Zero mutation commands. | Release decisions require stable Booking identity and read projections, but not Booking command completion. |
| **27 — Release Owner commands** | §§23–25, 28.3, 29; S18 | AC-21, AC-25, AC-26, AC-32 | Explicit Cancellation, Booking update reuse, and No Action; active Booking revalidation; revision races; official mirrors/outbox; referral cancellation compatibility. | Cancellation is enabled only after release cases are reviewed and canonical commands are proven. |
| **28 — Referral Booking workflow** | §8 Referral policy, §§19, 24.3, 29; S19 | AC-28 | Referral mode; no Lead selector; accepted Observation contact/Job; leadless canonical Booking; Booking-only Record Link; correct projection. | It is a special case built on accepted Booking create/update infrastructure and reviewed Registry classification. |
| **29 — Discrepancies and link correction** | §13 correction, §§22, 24.5, 28–29; S20 | AC-23, AC-26, AC-27, AC-35, AC-36 | Separate discrepancy models; non-PII fingerprints; open/refresh; re-evaluate/no-action; revision-guarded link correction and supersession history; UI/timeline. | Exception resolution comes after normal Booking and Release paths so it can route back into them safely. |
| **30 — Operations, metrics, and alerts** | §§28.2, 33; first half S21 | operational portions AC-31, AC-35, AC-37, AC-38 | PII-safe events/metrics; activation, queue, case, discrepancy, and RingCentral health; alert thresholds; Owner-safe health UI. | Full workflow coverage is needed to define accurate operational health and bounded labels. |
| **31 — Migration, shadow, security, and runbook certification** | §§27, 33–35, 37.2, 39–40; second half S21 | certification portions AC-31, AC-35, AC-37, AC-38 | Fixed migration package; index verifier; resumable historical shadow; zero-forbidden-effects report; masking/log audit; staged flags; rollback artifacts; full repository checks. | Certifies the complete synthetic/historical system before optional notification or cleanup. It is not the current-payload test. |
| **32 — Optional email notifications** | §32; S22 | No unique numbered AC; notification contract proof | Typed delivery purpose/case ref; one new-sequence email; no email on refresh; provider failure cannot alter/block cases; sandbox recipients until approved. | Email is deliberately outside the initial workflow and requires separate Owner acceptance after all cases work. |
| **33 — Cleanup and complete synthetic regression** | §§37.2, 38/S23, 39, 41 | Final automated coverage of AC-01–AC-40 | Remove prototype/Intake/generic names and old bypasses only after compatibility proof; update docs; full server/admin/extension synthetic regression. Durable evidence is never deleted. | Cleanup follows operational certification so rollback evidence and old-client compatibility are not removed prematurely. |
| **34 — Current webhook payload certification** | §§9–18, 26–28, 33–36, 39, 41 through production interfaces; standalone final unit | Samples completed AC behavior; replaces none of the automated AC owners | Isolated authenticated replay of current payload families; PII-safe Receipt -> Observation -> Decision -> permitted effect/no-effect matrix; no external effects; final go/no-go; regression remains green. | Last by design: real payloads validate the finished contract and cannot silently reshape it. |

## 5. Reverse mapping: final-spec section to owning units

This reverse view confirms that no final-spec section is orphaned. “All” means the section is inherited by every unit, even when an issue cites only its narrower task sections.

| Final-spec section | Primary unit coverage |
| --- | --- |
| **1. Purpose and authority** | All units; closure rechecked by 33–34 |
| **2. Outcome, scope, non-goals, migrations** | All; concrete migrations in 02, 06, 09, 13, 16–17, 20–23, 31, 33 |
| **3. Repository and branch contract** | All; cross-repository work in 06, 16–17, 23–30, 33–34 |
| **4. Non-negotiable invariants** | All; transaction proof in 10–11 and effect units 18–29; final proof 31, 33–34 |
| **5. Canonical language and aggregate boundaries** | 01 foundation; enforced by 04–31; deprecated-name cleanup in 33 |
| **6. End-to-end architecture** | 01 foundation; assembled by 02–18; reconciliation branches 22–29; certified by 31, 33–34 |
| **7. Shared TypeScript contracts** | 01, 04; consumed by all later runtime/interface units |
| **8. Source Registry** | 05–06, 14, 19, 28; operational proof 30–31 |
| **9. Receipt capture and security** | 02–03; channel application in 16–17; privacy certification 31 and payload certification 34 |
| **10. Observation normalization** | 01, 04; planner consumption 15; current-shape certification 34 |
| **11. Ordering/idempotency/decisions** | 07–08, 10, 15, 18; certified 31 and 34 |
| **12. Identity and Source Scope** | 14–15; live proof 18–20; reconciliation identity 22–29; certified 34 |
| **13. Granot Record Link** | 07, 14, 18–19, 22, 28–29 |
| **14. Aggregate additions/provenance** | 09, 12–13; mutation use 18–29; migration certification 31 |
| **15. Field authority/desired state** | 12, 14–15; live effect proof 18–19 |
| **16. Lead Created policy** | 14–15, 18–19 |
| **17. RingCentral convergence** | 19–21 |
| **18. Booking and Release semantics** | 22, 26; command enforcement 24–29 |
| **19. Booking Reconciliation** | 22–25, 28 |
| **20. Release Reconciliation** | 26–27 |
| **21. Reconciliation persistence** | 22, 26; concurrency certification 29, 31, 33 |
| **22. Discrepancies** | 26 routing seam; 29 full behavior |
| **23. Commands/provenance/transactions** | 09–11 foundation; 18–19 and 24–29 effect use |
| **24. Owner command inputs** | 10 common envelope; 24–25, 27–29 concrete commands |
| **25. Deep module interfaces** | 15 processor boundary; implemented/consumed by 18–29 |
| **26. Queue/lease/retry/dead letter** | 08; operations 30–31; current path certified 34 |
| **27. Shadow/activation/flags** | 07, 15–19, 31; certification 34 |
| **28. Server HTTP API** | 03, 07–08, 16–17, 23–31; certification 34 |
| **29. Vantage Admin** | 06, 23–30; final regression 33 |
| **30. Browser extension 0.2.8** | 16; parity effect proof 18; regression 33 |
| **31. HTTP automation** | 17; parity effect proof 18; regression 33 |
| **32. Notifications** | 32 only, optional by explicit Owner decision |
| **33. Observability/health** | 03, 07–08, 21, 30–31; certification 34 |
| **34. Migrations/scripts** | 02, 06, 09, 13, 31 |
| **35. Verification strategy** | Every unit at its prescribed level; package certification 31, 33–34 |
| **36. AC-01–AC-40 catalog** | Distributed exactly as Section 6 below; completeness gate 33; current-shape sample 34 |
| **37. Production file map/docs drift** | 01–02 and each implementation unit as applicable; audit 31; cleanup 33 |
| **38. S01–S23 slices** | S01→01; S02→02–03; S03→04; S04→05–06; S05→07; S06→08; S07→09–11; S08→09,12–13; S09→14–15; S10→16; S11→17; S12→18; S13→19; S14→20–21; S15→22–23; S16→24–25; S17→26; S18→27; S19→28; S20→29; S21→30–31; S22→32; S23→33. Unit 34 is the approved standalone certification addition. |
| **39. Rollout/rollback** | Effect gates 18–21 and 22–29; operational certification 30–31; cleanup 33; go/no-go 34 |
| **40. Deferred/fail-closed behavior** | 05–06, 14–15, 31; enforced program-wide |
| **41. Definition of complete** | 31 establishes certification prerequisites; 33 proves synthetic completeness; 34 makes final current-payload go/no-go |

## 6. Acceptance-scenario ownership

An acceptance scenario can have multiple owners because a foundation unit may establish its model contract while a later effect or interface unit supplies the complete proof. The final listed unit below is generally the complete production-interface boundary. Unit 34 samples this behavior against current payload shapes but never substitutes for automated tests.

| AC | Units | Required proof boundary |
| --- | --- | --- |
| AC-01 | 03 | Webhook authentication/capture route and credential-absence scan |
| AC-02 | 02, 03, 16, 17 | Receipt/operation identity across model, webhook, extension, and automation replay |
| AC-03 | 01, 14 | Outbound `leadno` contract and exact Form identity module test |
| AC-04 | 05, 14 | Runtime source policy and exact-identity conflict |
| AC-05 | 04, 15, 18 | Normalization, desired state, and live matched write |
| AC-06 | 04, 15 | Normalization and independent-action processing |
| AC-07 | 14, 15, 18, 19 | Identity through matched write and no-second-Lead creation race |
| AC-08 | 19 | Authorized creation transaction/race |
| AC-09 | 06, 14, 19 | Registry migration/routing through creation |
| AC-10 | 12, 15, 18 | Snapshot/model through planner, mutation, and projection |
| AC-11 | 12, 15, 18 | Immutable move evidence and authorized current-move update |
| AC-12 | 12, 15, 18 | Contact authority and Entity Change |
| AC-13 | 14, 15, 18 | Agent identity/matching and safe assignment |
| AC-14 | 20 | RingCentral adoption integration |
| AC-15 | 20 | Adoption-before-duplicate integration |
| AC-16 | 20 | Zero/multiple/Job-only convergence |
| AC-17 | 21 | Real lease/cursor/lookback concurrency |
| AC-18 | 22, 23 | Booking service plus read projection/UI |
| AC-19 | 22, 23 | Actual Booked mode through service/UI |
| AC-20 | 22, 23, 24, 25 | Sequence/evidence revision and Owner-form concurrency |
| AC-21 | 10, 24, 25, 27 | Canonical executor and Owner-command race/replay |
| AC-22 | 24 | Strict official Booking input and create command |
| AC-23 | 24, 29 | Out-of-scope selection and Record Link correction |
| AC-24 | 25 | Deterministic existing-Booking replacement |
| AC-25 | 26, 27 | Release read and explicit Owner command |
| AC-26 | 26, 27, 29 | Already-cancelled and Booked-after-cancellation behavior |
| AC-27 | 26, 29 | Release discrepancy routing/open-refresh |
| AC-28 | 28 | Leadless Referral service, command, projection, and UI |
| AC-29 | 04, 05, 06, 14 | Normalization, Registry, migration, and runtime policy |
| AC-30 | 08, 15 | Exact business retry clock and terminal planner outcomes |
| AC-31 | 07, 15, 31 | Activation/execution mode and historical-shadow certification |
| AC-32 | 10, 11, 18, 24, 25, 27 | Canonical causal chain/no-op proof at each mutation boundary |
| AC-33 | 16, 17, 18 | Extension/automation parity and live matched behavior |
| AC-34 | 16 | Extension storage/retry/version |
| AC-35 | 02, 03, 07, 23, 26, 29, 30, 31 | Persistence, route, projection, UI, and audit privacy |
| AC-36 | 22, 26, 29 | Case/discrepancy real-index concurrency |
| AC-37 | 08, 30, 31 | Requeue/dead letter, events/metrics, and certification |
| AC-38 | 05, 06, 30, 31 | Registry fail-closed behavior, migration, health, certification |
| AC-39 | 14, 22, 23 | Booking identity/delegation service and UI |
| AC-40 | 22, 26 | Coexisting Booking/Release cases through transaction/projection |

## 7. Human progress gates

Use the unit ledger for live status, but use these gates to avoid declaring a milestone complete too early.

| Gate | Units | Human confirmation required before advancing |
| --- | --- | --- |
| **A — Safe evidence** | 01–04 | Fixtures are redacted; auth cannot persist credentials; receipt capture commits before `202`; normalization vocabulary is exact. |
| **B — Shadow-capable core** | 05–15 | Registry data is reviewed; migrations/indexes verify; canonical transaction foundation passes replica-set tests; identity/planner results are explainable; shadow produces zero forbidden effects. |
| **C — Three-channel parity** | 16–17 | Webhook, extension, and automation yield equivalent desired state/outcomes for equivalent statements; no legacy apply bypass remains authoritative. |
| **D — Lead effects** | 18–19 | Matched writes are observed for one reviewed source before creation is enabled; creation policy changes are audited one source at a time. |
| **E — RingCentral safety** | 20–21 | Adoption and duplicate tests are green at old cadence; lease/overlap/cursor telemetry is green before the 30-minute cron change. |
| **F — Reconciliation reads** | 22–23, 26 | Owner reviews Booking and Release queues/details while commands are still disabled; masking and concurrency behavior are accepted. |
| **G — Reconciliation effects** | 24–25, 27–29 | Every official mutation is explicit, canonical, revision-guarded, idempotent, and causally complete; No Action produces no aggregate/outbox mutation. |
| **H — Operational certification** | 30–31 | Health/alerts are usable; report→apply→verify migrations pass; historical shadow has zero forbidden effects; security/log audit and rollback artifacts are accepted. |
| **I — Optional email decision** | 32 | Owner explicitly includes or excludes email. If excluded, record “not included” and proceed; do not renumber later units. |
| **J — Synthetic completion** | 33 | AC-01–AC-40 pass at prescribed production interfaces; compatibility removal is supported by evidence; full server/admin/extension checks are green. |
| **K — Final go/no-go** | 34 | Current payload replay matrix is PII-safe and complete; no external effects; any defects were fixed in their owning unit contracts; full regression remains green. |

For each unit, do not move it to `complete` until its handoff records: commit(s), files changed, migrations/indexes, flags, AC-tagged tests, commands and results, staging/live evidence if required, privacy review, rollback, unresolved warnings, and the exact next-unit prerequisites that were established.

## 8. Current position and next action

At the time of this mapping review:

- Unit 01 is complete.
- Unit 02 is complete.
- Unit 03 is the next implementation target, but its scaffold must first be refined against the landed Unit 02 receipt model and completion evidence.
- Units 05 and 09 are independent contract-refinement candidates after Unit 01, but shared-branch implementation remains sequential by default unless there is an explicit integration owner.
- Unit 32 is optional in the approved specification. If the intention is literally to execute all 34 numbered units, the Owner must explicitly approve email inclusion after the case workflows are accepted. If email is excluded, the release executes 33 units while retaining Unit 33 and Unit 34 numbering.

The immediate stay-on-track sequence is therefore:

1. Re-verify Unit 02 repository state, migration/index output, and completion report.
2. Refine Unit 03 from scaffold to complete issue contract.
3. Implement and prove Unit 03; do not absorb Unit 04 normalization work.
4. Repeat the refine → implement → verify → handoff loop for each newly unblocked unit.
5. Treat parity approval, Owner read-only workflow review, optional email approval, compatibility-removal approval, and Unit 34 go/no-go as explicit human gates—not implicit consequences of passing tests.

## 9. Final assessment

There is no uncovered final-spec requirement or acceptance scenario in the approved 34-unit map. The dependency structure is conservative for the right reasons: it protects credentials and evidence first, makes policy and identity explainable before effects, proves atomic causal writes before business mutations, separates human review from automatic Granot evidence, and reserves current customer-shaped payloads for isolated final certification.

The two execution risks to keep visible are procedural rather than specification gaps:

1. A scaffold is not an implementation-ready issue. Each next unit must be refined from actual landed repository state.
2. Unit 32 cannot silently become required. Record the explicit include/exclude decision, while Unit 34 remains mandatory and final in either case.
