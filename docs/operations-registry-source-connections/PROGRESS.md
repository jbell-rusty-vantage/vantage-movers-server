# PROGRESS — Operations Registry source connections and Owner UI

**This is the live ledger. Every pass updates it — on pickup and on close.**
It is a navigation aid, not an authority. Where it disagrees with the
repository, the repository is right and the next agent fixes this file.

Pack created 2026-08-24. Protocol: [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md).

## Pass status

| Pass | Title | Prereqs | Status | Owner / agent | Started | Closed | Report |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [ORS-1](issues/ORS-1.md) | Typed label mappings and collection-first source resolution | — | `ready` | — | — | — | — |
| [ORS-2](issues/ORS-2.md) | Granot name Owner command, SMS invariant, texting company context | — | `ready` | — | — | — | — |
| [ORS-3](issues/ORS-3.md) | Aggregate Lead Source projection, combined setup command, RingCentral DTOs | ORS-1, ORS-2 | `blocked` | — | — | — | — |
| [ORS-4](issues/ORS-4.md) | Owner UI, language deck, acceptance sweep | ORS-3 | `blocked` | — | — | — | — |

Status vocabulary: `ready` · `active` · `blocked` · `complete` · `deferred`.

## Specification coverage

One row per specification section. A row is ticked by the pass that closes it,
with the evidence named. Unticked rows at the end of ORS-4 are the honest
remainder — do not tick a row to make the table look finished.

| Spec § | Subject | Pass | Done | Evidence |
| --- | --- | --- | --- | --- |
| §2.1–2.4 | Field ownership, three matching paths, create-vs-activate consequences | ORS-4 | ☐ | |
| §3.1 | Lead Source model; embedded `granularities[]` reported | ORS-1 | ☐ | |
| §3.2 | Feed model unchanged; activation stays fail-closed | ORS-1 | ☐ | |
| §3.3 | `lead_source_label_mappings` first-class collection | ORS-1 | ☐ | |
| §3.4 | Granot name → one Lead Source + one Feed; move-type exception | ORS-2 | ☐ | |
| §3.4.1–3.4.2 | Exact-spelling warning and the activation ladder as a checklist | ORS-2, ORS-4 | ☐ | |
| §3.4.3 | `crm_origin` / `workspace_slug` / legacy `source_company` derived server-side | ORS-2 | ☐ | |
| §3.5 | Single-feed Lead Sources keep a first-class Feed | ORS-3 | ☐ | |
| §3.6 | RingCentral route/assignment contract and derivation | ORS-3 | ☐ | |
| §3.6.1 | Ingestion preconditions, delay, no back-fill, phone lock stated to the Owner | ORS-4 | ☐ | |
| §4.1 | Three `lead_created` policies in Owner language | ORS-2 | ☐ | |
| §4.2 | SMS invariant on **both** write paths; template version resets | ORS-2 | ☐ | |
| §4.2 | `daily_cap` resolved (enforced or removed from Owner contract) | ORS-2 | ☐ | |
| §4.3 | Text preview: Vantage Movers brand, empty first name, appended opt-out, on+edit stays off | ORS-4 | ☐ | |
| §5.1 | Sheet/legacy resolution collection-first, instrumented fallback | ORS-1 | ☐ | |
| §5.2 | Granot observation resolution + decision snapshot | ORS-2 | ☐ | |
| §5.3 | RingCentral call resolution unchanged, explained in DTO | ORS-3 | ☐ | |
| §6.1 | Aggregate Lead Source read projection | ORS-3 | ☐ | |
| §6.2 | Label mapping routes + resolution preview | ORS-1 | ☐ | |
| §6.3 | `POST /admin/granot-crm-sources` intent DTO | ORS-2 | ☐ | |
| §6.3 | `POST /admin/operations-registry/lead-source-setups` — Lead Source + Feed + Granot name, atomic | ORS-3 | ☐ | |
| §6.3 | `POST …/lead-source-setups/preview` — full validation, no write | ORS-3 | ☐ | |
| §6.3 | Setup response carries the ordered readiness plan | ORS-3 | ☐ | |
| §6.4 | RingCentral DTOs carry joined Lead Source / Feed labels | ORS-3 | ☐ | |
| §7.1 | Lead sources information architecture | ORS-4 | ☐ | |
| §7.2 | Lead Source detail with Feed cards | ORS-4 | ☐ | |
| §7.3 | Granot name editor progressive disclosure + review sentence | ORS-4 | ☐ | |
| §7.4 | New Lead Source guided setup — five-step wizard, two commit points | ORS-4 | ☐ | |
| §7.4.2 | Step 3 skippable; step 5 is a persistent server-derived checklist | ORS-4 | ☐ | |
| §7.5 | Inbound number editor copy and connection card | ORS-4 | ☐ | |
| §7.5.1 | Ingestion copy verbatim; status not derived from `active` alone | ORS-4 | ☐ | |
| §7.6 | Language deck enforced as a test | ORS-4 | ☐ | |
| §8 | Health findings — label mappings | ORS-1 | ☐ | |
| §8 | Health findings — Granot semantic drift, SMS gates, `daily_cap` | ORS-2 | ☐ | |
| §8 | Findings translated to Owner action + deep link | ORS-3 | ☐ | |
| §9.1–9.2 | Inventory + embedded `granularities[]` usage report | ORS-1 | ☐ | |
| §9.3–9.5 | Mappings created in report mode, applied, resolvers switched | ORS-1 | ☐ | |
| §9.6 | Aggregate projections and Owner copy/UI | ORS-3, ORS-4 | ☐ | |
| §9.7 | Compatibility reads observed to zero | ORS-4 opens | ☐ | window start: |
| §9.8 | Static maps, embedded granularities, indexes removed | **out of pack** | ☐ | separately reviewed migration |

## Acceptance criteria (specification §10)

Final sweep is ORS-4's job, but any pass that satisfies one ticks it early with
evidence.

| # | Criterion | Pass | Done |
| --- | --- | --- | --- |
| 1 | Owner sees every Feed, sheet label, Granot name, number, and CPL state on one Lead Source | ORS-4 | ☐ |
| 2 | Ordinary Granot name shows one explicit Lead Source → Feed; exception shows both Feeds and the rule | ORS-4 | ☐ |
| 3 | Paid Overflow-like sources use single-feed setup, first-class Feed intact | ORS-3 | ☐ |
| 4 | Every active inbound number shows one current Lead Source → Feed assignment, not its nickname | ORS-4 | ☐ |
| 5 | Client cannot submit inconsistent company/Feed IDs for RingCentral or Granot | ORS-2, ORS-3 | ☐ |
| 6 | Runtime Granot and sheet matching is exact and deterministic | ORS-1, ORS-2 | ☐ |
| 7 | Three policies tested independently for link, enrich, create, and text effects | ORS-2 | ☐ |
| 8 | No successful write leaves SMS enabled under a non-`create_if_missing` policy | ORS-2 | ☐ |
| 9 | Confirmation text only for a newly created Lead, at most once per observation | ORS-2 | ☐ |
| 10 | Editing a text template visibly leaves texting off until re-enabled | ORS-2, ORS-4 | ☐ |
| 11 | No Owner primary surface exposes implementation enums or raw ObjectIds | ORS-4 | ☐ |
| 12 | Static label-map compatibility usage is visible in Registry Health | ORS-1 | ☐ |
| 13 | One flow creates Lead Source + Feed + Granot name; a failure leaves none of the three | ORS-3 | ☐ |
| 14 | Review renders a server preview; every collision it can report is reachable in a test | ORS-3, ORS-4 | ☐ |
| 15 | The Granot step is skippable and the resulting Lead Source is valid and usable | ORS-3, ORS-4 | ☐ |
| 16 | Go-live is a server-derived checklist; blocked steps name what they wait on; no self-ticking | ORS-3, ORS-4 | ☐ |
| 17 | Owner is told before first activation that the number locks and earlier calls are not back-filled | ORS-4 | ☐ |
| 18 | An active number with failed validation reads as "stopped filing calls" | ORS-4 | ☐ |
| 19 | Feed display name and "what Vantage sends to Granot" are distinct, and the sheet consequence is stated | ORS-4 | ☐ |
| 20 | Text preview shows Vantage Movers, the empty first name, and the appended opt-out — not the Lead Source name | ORS-4 | ☐ |
| 21 | Requesting texting on with an edited body results in off, said before and shown after | ORS-2, ORS-4 | ☐ |

## Cross-pass findings

Work discovered in one pass that belongs to another. Do not fix it in place —
record it here and in the target pass's issue.

| Found in | Belongs to | Finding | Recorded in issue |
| --- | --- | --- | --- |
| spec review 2026-08-24 | **outside this pack** | The admin filter is labelled "Source Company" but its options are Feeds (`owner_label` / `granularity_key`). That contradicts the §7.6 deck. The deck is this document's; the filter surface belongs to `admin-filter-catalog-and-analytics-specification.md`. Needs a cross-specification decision, not a rename in either one. | spec §11 |
| spec review 2026-08-24 | ORS-1 | Alias matching is `trim`+`lowercase` only while Granot matching is NFKC+collapse+lowercase. An alias with doubled or non-breaking whitespace can never match. Decide whether to align the normalizers or only to warn at input. | spec §2.2, §8 |
| spec review 2026-08-24 | ORS-3 | `previewRingCentralRouteDependencies` returns a hardcoded `can_deactivate: true` — it counts dependencies but gates nothing. Either make it a real gate or stop returning the field. | spec §11 |
| spec review 2026-08-24 | ORS-2 | `crm_label` uniqueness is enforced only at Feed activation. The setup command must apply the same predicate early; factor it out of `assertExactIdentifiersAvailable` rather than duplicating the regex. | ORS-3 §6.3 |
| spec review 2026-08-26 | ORS-2, ORS-4 | Customer texts identify **Vantage Movers**. `{company}` is a leftover placeholder; Owner copy must not present `LeadSourceCompany.name` as the SMS brand. Current admin preview interpolates `lead_source_company_label` and is wrong for the default template. | spec §4.3, §11 |

## Open questions for the Owner

Anything a pass could not decide from the specification. A pass that hits one
sets itself `blocked` and adds a row.

| Raised by | Date | Question | Answer | Answered |
| --- | --- | --- | --- | --- |
| pack | 2026-08-24 | §4.2 `daily_cap`: enforce with an atomic per-source/day limiter, or remove from the Owner contract? ORS-2 proceeds with **remove** unless answered otherwise. | | ☐ |
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
```
