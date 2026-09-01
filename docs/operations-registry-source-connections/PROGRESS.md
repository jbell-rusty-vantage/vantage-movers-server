# PROGRESS — Operations Registry source connections and Owner UI

**This is the live ledger. Every pass updates it — on pickup and on close.**
It is a navigation aid, not an authority. Where it disagrees with the
repository, the repository is right and the next agent fixes this file.

Pack created 2026-08-24. Protocol: [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md).

## Pass status

| Pass | Title | Prereqs | Status | Owner / agent | Started | Closed | Report |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [ORS-1](issues/ORS-1.md) | Typed label mappings and collection-first source resolution | — | `complete` | orchestrator + ORS-1 agent | 2026-09-01 | 2026-09-01 | [reports/ORS-1-completion.md](reports/ORS-1-completion.md) |
| [ORS-2](issues/ORS-2.md) | Granot name Owner command, SMS invariant, texting company context | — | `complete` | orchestrator + ORS-2 agent | 2026-09-01 | 2026-09-01 | [reports/ORS-2-completion.md](reports/ORS-2-completion.md) |
| [ORS-3](issues/ORS-3.md) | Aggregate Lead Source projection, combined setup command, RingCentral DTOs | ORS-1, ORS-2 | `complete` | orchestrator + ORS-3 agent | 2026-09-01 | 2026-09-01 | [reports/ORS-3-completion.md](reports/ORS-3-completion.md) |
| [ORS-4](issues/ORS-4.md) | Owner UI, language deck, acceptance sweep | ORS-3 | `complete` | orchestrator + ORS-4 agent | 2026-09-01 | 2026-09-01 | [reports/ORS-4-completion.md](reports/ORS-4-completion.md) |

Status vocabulary: `ready` · `active` · `blocked` · `complete` · `deferred`.

## Specification coverage

One row per specification section. A row is ticked by the pass that closes it,
with the evidence named. Unticked rows at the end of ORS-4 are the honest
remainder — do not tick a row to make the table look finished.

| Spec § | Subject | Pass | Done | Evidence |
| --- | --- | --- | --- | --- |
| §2.1–2.4 | Field ownership, three matching paths, create-vs-activate consequences | ORS-4 | ☑ | Wizard + Granot editor + inbound checklist state create vs activate. Matching paths unchanged (ORS-1/2/3). |
| §3.1 | Lead Source model; embedded `granularities[]` reported | ORS-1 | ☑ | `reportEmbeddedGranularitiesUsage`; `--report` §9.2 block. Nothing removed. |
| §3.2 | Feed model unchanged; activation stays fail-closed | ORS-1 | ☑ | Mapping create requires an active Feed; inactive-Feed resolution fails closed. Feed activation rules untouched. |
| §3.3 | `lead_source_label_mappings` first-class collection | ORS-1 | ☑ | `src/models/LeadSourceLabelMapping.ts` + audited service. |
| §3.4 | Granot name → one Lead Source + one Feed; move-type exception | ORS-2 | ☑ | Owner create: `one_feed` writes one `any` route; `form_by_move_type` is explicit and Form-only. |
| §3.4.1–3.4.2 | Exact-spelling warning and the activation ladder as a checklist | ORS-2, ORS-4 | ☑ | Server gate checklist on create (ORS-2). Owner render: persistent `ReadinessChecklist` from `readiness_plan`; Granot editor review + normalized-name warning. |
| §3.4.3 | `crm_origin` / `workspace_slug` / legacy `source_company` derived server-side | ORS-2 | ☑ | Derived in `ownerGranotNames.ts`. Client keys rejected. CSV string left `not_provided`. |
| §3.5 | Single-feed Lead Sources keep a first-class Feed | ORS-3 | ☑ | Setup creates Lead Source + first-class Feed together. Paid Overflow-shaped setup leaves existing `paid_overflow` Feed unchanged. |
| §3.6 | RingCentral route/assignment contract and derivation | ORS-3 | ☑ | Activation/reassignment still take `source_granularity_id` only. DTO now carries Lead Source → Feed labels. `can_deactivate` removed. |
| §3.6.1 | Ingestion preconditions, delay, no back-fill, phone lock stated to the Owner | ORS-4 | ☑ | `inboundPreActivationCopy` verbatim in inbound editor. |
| §4.1 | Three `lead_created` policies in Owner language | ORS-2 | ☑ | `watch_only` / `existing_only` / `create_if_missing` → `observation_only` / `link_only` / `create_if_missing`. |
| §4.2 | SMS invariant on **both** write paths; template version resets | ORS-2 | ☑ | Update path turns SMS off in the same `$set`. SMS enable-guard + template-version verified, not rebuilt. |
| §4.2 | `daily_cap` resolved (enforced or removed from Owner contract) | ORS-2 | ☑ | Removed from Owner contract. Stored field left. Health finding for non-zero cap. |
| §4.3 | Text preview: Vantage Movers brand, empty first name, appended opt-out, on+edit stays off | ORS-4 | ☑ | `smsPreview.ts`: brand Vantage Movers; empty first name `there`; `{company}` → Vantage Movers; opt-out counted. Template edit copy turns texting off. |
| §5.1 | Sheet/legacy resolution collection-first, instrumented fallback | ORS-1 | ☑ | `resolveSheetOrLegacyLabel`; named test asserts static map was not read. |
| §5.2 | Granot observation resolution + decision snapshot | ORS-2 | ☑ | `SourcePolicySnapshot` already had the fields. Extended tests only; no parallel record. |
| §5.3 | RingCentral call resolution unchanged, explained in DTO | ORS-3 | ☑ | Resolver untouched. Assignment DTO now includes Lead Source name, Feed display name, keys, channel, effective dates. |
| §6.1 | Aggregate Lead Source read projection | ORS-3 | ☑ | `GET …/lead-sources` and `GET …/lead-sources/:id`. Detail is ORS-4's §7.2 data source. |
| §6.2 | Label mapping routes + resolution preview | ORS-1 | ☑ | Four routes in `v1.routes.ts`; `sourceLabelMappings.validation.ts`. |
| §6.3 | `POST /admin/granot-crm-sources` intent DTO | ORS-2 | ☑ | `POST /api/v1/admin/granot-crm-sources` + `ownerGranotNameCreateSchema`. |
| §6.3 | `POST /admin/operations-registry/lead-source-setups` — Lead Source + Feed + Granot name, atomic | ORS-3 | ☑ | `leadSourceSetup.ts`. One transaction. All inactive. Granot optional. |
| §6.3 | `POST …/lead-source-setups/preview` — full validation, no write | ORS-3 | ☑ | Same validation. Returns derived keys, collisions, readiness plan. |
| §6.3 | Setup response carries the ordered readiness plan | ORS-3 | ☑ | Gates name the existing command and `blocked_until`. |
| §6.4 | RingCentral DTOs carry joined Lead Source / Feed labels | ORS-3 | ☑ | One `$in` per companies and Feeds. Request bodies unchanged. |
| §7.1 | Lead sources information architecture | ORS-4 | ☑ | Tabs: Lead sources / Granot names / Inbound numbers / Lead costs. Moving Carriers + Legacy CPL kept. `tests/registry-shell.test.ts`. |
| §7.2 | Lead Source detail with Feed cards | ORS-4 | ☑ | One GET. `tests/lead-source-detail.test.ts` from ORS-3 fixture. |
| §7.3 | Granot name editor progressive disclosure + review sentence | ORS-4 | ☑ | Exact order. Both review sentences verbatim. `tests/granot-name-editor.test.ts`. |
| §7.4 | New Lead Source guided setup — five-step wizard, two commit points | ORS-4 | ☑ | Steps 1–4 in wizard; commit 1 = setup POST; step 5 = detail checklist. Single-feed only. |
| §7.4.2 | Step 3 skippable; step 5 is a persistent server-derived checklist | ORS-4 | ☑ | `includeGranot: false` + “Not yet”. Checklist re-fetches after each action. |
| §7.5 | Inbound number editor copy and connection card | ORS-4 | ☑ | Nickname helper + “Calls to this number are filed under”. |
| §7.5.1 | Ingestion copy verbatim; status not derived from `active` alone | ORS-4 | ☑ | Failed-validation + active → “This number has stopped filing calls.” |
| §7.6 | Language deck enforced as a test | ORS-4 | ☑ | Shared banned list. Server DTO walk + admin markup. |
| §8 | Health findings — label mappings | ORS-1 | ☑ | `registry.label_mapping_destination_invalid`, `registry.label_mapping_collision`; compatibility counter is the real §6.3 telemetry. |
| §8 | Health findings — Granot semantic drift, SMS gates, `daily_cap` | ORS-2 | ☑ | Five codes appended after label-mapping findings. Drift script report-only. |
| §8 | Findings translated to Owner action + deep link | ORS-3 | ☑ | `findingTranslation.ts`. Exhaustive over emitted health codes. Unknown codes surface. |
| §8 | Owner rendering of findings + observation window | ORS-4 | ☑ | Action + deep link on Lead Source detail; raw code in `<details>`. Compatibility statement always on Registry Health. |
| §9.1–9.2 | Inventory + embedded `granularities[]` usage report | ORS-1 | ☑ | Extended inventory lib (static + Feed crm_label/alias + Lead snapshots); `--report` on `testvantagemovers`. |
| §9.3–9.5 | Mappings created in report mode, applied, resolvers switched | ORS-1 | ☑ | Report-first (1 ok / 26 zero_match / 0 multiple_match / 3 cross_company; no manifest). `--apply` checksum-guarded. Resolver is collection-first. Production apply not authorized. |
| §9.6 | Aggregate projections and Owner copy/UI | ORS-3, ORS-4 | ☑ | Server: list/detail + readiness plan. Owner: lead-sources tab, detail, wizard, Granot editor, inbound editor. |
| §9.7 | Compatibility reads observed to zero | ORS-4 opens | ☐ | window start: **2026-09-01**. Opened, not closed. Health + Registry Health statement. Removal blocked until count holds at zero. |
| §9.8 | Static maps, embedded granularities, indexes removed | **out of pack** | ☐ | separately reviewed migration |

## Acceptance criteria (specification §10)

Final sweep is ORS-4's job, but any pass that satisfies one ticks it early with
evidence.

| # | Criterion | Pass | Done |
| --- | --- | --- | --- |
| 1 | Owner sees every Feed, sheet label, Granot name, number, and CPL state on one Lead Source | ORS-4 | ☑ | `tests/lead-source-detail.test.ts` from one ORS-3 fixture. |
| 2 | Ordinary Granot name shows one explicit Lead Source → Feed; exception shows both Feeds and the rule | ORS-4 | ☑ | Connection line + Best Relocation move-type selection rule. |
| 3 | Paid Overflow-like sources use single-feed setup, first-class Feed intact | ORS-3 | ☑ | Setup creates a new first-class Feed. Existing `paid_overflow` Feed unchanged. |
| 4 | Every active inbound number shows one current Lead Source → Feed assignment, not its nickname | ORS-4 | ☑ | Connection card “Best Relocation → Inbound calls”. Nickname helper says it decides nothing. |
| 5 | Client cannot submit inconsistent company/Feed IDs for RingCentral or Granot | ORS-2, ORS-3, ORS-4 | ☑ | Server rejects mismatched IDs (ORS-2/3). Proxy independently blocks admin POST on setup commit and Granot create (`authorization.test.ts`). |
| 6 | Runtime Granot and sheet matching is exact and deterministic | ORS-1, ORS-2 | ☑ | Sheet/legacy: NFKC exact + fail-closed. Granot: `normalizeGranotSourceLabel` on Owner create and runtime; duplicate normalized name rejected. |
| 7 | Three policies tested independently for link, enrich, create, and text effects | ORS-2 | ☑ | Twelve-outcome table in `sourcePolicy.test.ts` and ORS-2-completion. |
| 8 | No successful write leaves SMS enabled under a non-`create_if_missing` policy | ORS-2 | ☑ | Update `$set` + SMS enable-guard. Asserted on stored document. |
| 9 | Confirmation text only for a newly created Lead, at most once per observation | ORS-2 | ☑ | `link_only` sends nothing; replay → `already_sent`. |
| 10 | Editing a text template visibly leaves texting off until re-enabled | ORS-2, ORS-4 | ☑ | Server: template change increments version and leaves `enabled` false. UI: “Saving a new message turns texting off.” |
| 11 | No Owner primary surface exposes implementation enums or raw ObjectIds | ORS-4 | ☑ | `ownerLanguageDeck.test.ts` + `tests/language-deck.test.ts`. |
| 12 | Static label-map compatibility usage is visible in Registry Health | ORS-1, ORS-4 | ☑ | Telemetry + Health finding (ORS-1). Owner observation-window sentence + `CompatibilityObservationStatement` (ORS-4). Window start 2026-09-01. |
| 13 | One flow creates Lead Source + Feed + Granot name; a failure leaves none of the three | ORS-3 | ☑ | One transaction. Mid-failure and collision tests leave store counts at 0. |
| 14 | Review renders a server preview; every collision it can report is reachable in a test | ORS-3, ORS-4 | ☑ | Server preview collisions (ORS-3). UI review renders `preview` only (`tests/lead-source-setup.test.ts`). |
| 15 | The Granot step is skippable and the resulting Lead Source is valid and usable | ORS-3, ORS-4 | ☑ | Server omit `granot` (ORS-3). UI: “Not yet”; readiness suggests “Connect a Granot name”. |
| 16 | Go-live is a server-derived checklist; blocked steps name what they wait on; no self-ticking | ORS-3, ORS-4 | ☑ | `ReadinessChecklist` from `readiness_plan`; refetch after each action; “Waiting on: …”. |
| 17 | Owner is told before first activation that the number locks and earlier calls are not back-filled | ORS-4 | ☑ | `inboundPreActivationCopy` (30 min, no back-fill, phone lock). |
| 18 | An active number with failed validation reads as "stopped filing calls" | ORS-4 | ☑ | `tests/inbound-number-editor.test.ts` asserts the verbatim sentence. |
| 19 | Feed display name and "what Vantage sends to Granot" are distinct, and the sheet consequence is stated | ORS-4 | ☑ | Wizard step 2 + feed cards. Sheet = Source Company column. |
| 20 | Text preview shows Vantage Movers, the empty first name, and the appended opt-out — not the Lead Source name | ORS-4 | ☑ | `tests/granot-crm-sources-manager.test.ts` SMS preview. |
| 21 | Requesting texting on with an edited body results in off, said before and shown after | ORS-2, ORS-4 | ☑ | Server leaves `enabled` false. UI warning before save. |

## Cross-pass findings

Work discovered in one pass that belongs to another. Do not fix it in place —
record it here and in the target pass's issue.

| Found in | Belongs to | Finding | Recorded in issue |
| --- | --- | --- | --- |
| spec review 2026-08-24 | **outside this pack** | The admin filter is labelled "Source Company" but its options are Feeds (`owner_label` / `granularity_key`). That contradicts the §7.6 deck. The deck is this document's; the filter surface belongs to `admin-filter-catalog-and-analytics-specification.md`. Needs a cross-specification decision, not a rename in either one. | spec §11 |
| spec review 2026-08-24 | ORS-1 | Alias matching is `trim`+`lowercase` only while Granot matching is NFKC+collapse+lowercase. An alias with doubled or non-breaking whitespace can never match. Decide whether to align the normalizers or only to warn at input. | spec §2.2, §8 |
| spec review 2026-08-24 | ORS-3 | `previewRingCentralRouteDependencies` returns a hardcoded `can_deactivate: true` — it counts dependencies but gates nothing. Either make it a real gate or stop returning the field. **Resolved in ORS-3:** stopped returning the field. Counts remain. | spec §11 |
| spec review 2026-08-24 | ORS-2 | `crm_label` uniqueness is enforced only at Feed activation. The setup command must apply the same predicate early; factor it out of `assertExactIdentifiersAvailable` rather than duplicating the regex. | ORS-3 §6.3. **Closed in ORS-3:** exported and used early on setup. |
| spec review 2026-08-26 | ORS-2, ORS-4 | Customer texts identify **Vantage Movers**. `{company}` is a leftover placeholder; Owner copy must not present `LeadSourceCompany.name` as the SMS brand. Current admin preview interpolates `lead_source_company_label` and is wrong for the default template. | spec §4.3, §11 |

## Open questions for the Owner

Anything a pass could not decide from the specification. A pass that hits one
sets itself `blocked` and adds a row.

| Raised by | Date | Question | Answer | Answered |
| --- | --- | --- | --- | --- |
| pack | 2026-08-24 | §4.2 `daily_cap`: enforce with an atomic per-source/day limiter, or remove from the Owner contract? ORS-2 proceeds with **remove** unless answered otherwise. | Owner unanswered. ORS-2 removed it from the Owner contract. Stored field left. Health finding for non-zero cap. | ☑ |
| pack | 2026-08-24 | §9.7 observation window length before static maps may be removed. ORS-4 opens the window and records the start; the duration is the Owner's call. | | ☐ |

## Pass log

Append-only. Newest last. One entry per pickup, block, and close.

```text
2026-08-24 · pack created · ORS-1 and ORS-2 ready; ORS-3 and ORS-4 blocked on prerequisites.
2026-08-24 · specification enhanced against the code (§2.1-2.2, §3.4.1-3.4.3, §3.6.1, §4.3, §6.3, §7.4, §7.5.1, §8, §10, §11).
             ORS-2 §6.1 gains the derived-field table; ORS-3 §6.3 becomes the combined setup + preview command;
             ORS-4 §6.4 becomes the five-step wizard with two commit points. Four cross-pass findings recorded.
             No code changed. Pass statuses unchanged.
2026-08-26 · specification re-aligned to live matching, Granot policy, SMS brand, and RingCentral create.
             §2.3 three matching paths; §2.4 create-vs-activate consequences; §4.3 texts say Vantage Movers
             (not Lead Source name); sheet column corrected to Source Company; Lead Source + Granot name
             remain one Owner flow; inbound-number create is unfinished until validated and mapped to a
             call Feed. Cross-pass finding recorded for ORS-2/ORS-4 SMS preview. No code changed.
2026-09-01 · orchestration started on branch `operations-registry-source-connections` (vantage-main-server).
             Spec lives in this pack folder; a pointer remains at the historical path so knowledge links resolve.
             ORS-1 picked up. Sequential passes: ORS-1 → ORS-2 → ORS-3 → ORS-4. No commit authorized.
2026-09-01 · ORS-2 picked up on the same branch. No commit authorized.
             0 ok / 23 zero_match / 0 multiple_match / 0 cross_company; no manifest. ORS-3 stays blocked
             (ORS-2 not done). vantage-admin untouched. No commit.
2026-09-01 · ORS-1 re-closed after inventory completeness. `--report` now inventories static labels,
             Feed crm_label/aliases, and distinct Lead snapshot strings on the allowed DB. 46 focused
             tests pass; typecheck pass. testvantagemovers --report: 1 ok / 26 zero_match / 0
             multiple_match / 3 cross_company (U19 Call, U19 Form Local, U19 Form Long named); no
             manifest. ORS-3 stays blocked (ORS-2 not done). vantage-admin untouched. No commit.
2026-09-01 · ORS-2 closed. Owner create translation → existing Granot write; SMS-off on policy
             leave-create_if_missing in the same mutation; daily_cap removed from Owner contract;
             snapshot/SMS call chain verified not rebuilt; five Granot health findings; report-only
             drift on testvantagemovers: 9 sources / 0 findings. 74 focused tests pass, 1 pre-existing
             replica-set skip; typecheck pass. ORS-3 moved to ready. vantage-admin untouched.
             No SMS enabled, no send, no lifecycle flag change, no commit.
2026-09-01 · ORS-3 picked up on the same branch. No commit authorized.
2026-09-01 · ORS-3 closed. Aggregate Lead Source projection + atomic inactive
             setup (Granot optional) + readiness plan + RC DTO enrichment.
             can_deactivate removed. 39 focused tests pass; typecheck pass.
             ORS-4 moved to ready. vantage-admin untouched. No SMS, no send,
             no commit.
2026-09-01 · ORS-4 picked up. Admin branch `operations-registry-source-connections`.
             Do not touch unrelated dirty files in vantage-admin. No commit authorized.
2026-09-01 · ORS-3 close verified after typecheck. Focused suite 46/46 (includes
             health + v1 routes); `pnpm typecheck` exit 0. Redacted detail
             projection in reports/ORS-3-completion.md. ORS-4 already `active`.
             vantage-admin untouched. No SMS, no send, no commit.
2026-09-01 · ORS-4 closed. Owner UI on admin branch
             `operations-registry-source-connections`. Single-feed wizard
             (commit 1 setup POST; commit 2 readiness checklist). Granot
             skippable. Inbound numbers file under Lead Source → Feed.
             Language deck tested on both repos. Observation window opened
             2026-09-01 — not closed. Server focused 30/30; admin 388/388;
             both typechecks exit 0; admin `pnpm build` exit 0. No
             screenshots; no preview deploy ids. Unrelated granot-lifecycle
             dirty files left untouched. No SMS, no send, no commit, no push.
             Honest remainder: §9.8 removals are OUT of pack. Static maps,
             embedded granularities[], indexes, and stored daily_cap remain.
2026-09-01 · Browser verification on local admin (production API scope).
             Inbound connection card now joins Lead Source → Feed from the
             catalog when the DTO has no labels. ObjectIds hidden. Lead
             sources projection 404s until this server branch is the API
             host. Notes: sessions/VERIFICATION.md. No commit.
```
