# 16 — MCP tool surface, precomputed context, and the attachment logic

Status: analysis and recommendation. Not a delivery plan, not a contract change.
Authority for product rules stays with [01](01-specification.md), [03](03-server-pipeline-and-jobs.md), [10](10-intelligence-agent-contract.md).
Companion reading: [13](13-number-analysis-surfaces.md) (as-built surfaces), [15](15-analysis-context-and-model-efficiency.md) (what the model is given, and why 800k), [14 — Call Log and Number search efficiency](14-call-log-and-number-search-efficiency.md) (the Mongo-side cost of the same lookups).
Code of record: `vantage-movers-mcp/{app/api,lib}/**`, `src/services/salesIntelligence/analysis/{run,runtime,reads,sources}.ts`, `src/services/salesIntelligence/attachment/**`, `src/services/salesIntelligence/conversations/eligibility.ts`.

No customer phones appear in this document.

This document answers four questions that were asked directly. Each section opens with the answer.

| Question | Answer |
| --- | --- |
| Is the MongoDB MCP server composed into intelligence-mcp? | **No.** Two handlers, two credentials, and intelligence credentials are explicitly 403'd on the Mongo endpoint. |
| Are the tools too large? | **One tool is.** `submit_intelligence_analysis` is 41,605 of 45,411 bytes — **91.6%**. The eleven read tools together are 3,806 bytes. |
| Can tool selection be dynamic? | **The mechanism already exists end to end and is hardcoded wide open.** One line sets all twelve tools on every run. But narrowing tools saves only ~3 KB — it is a precision fix, not a size fix. |
| Can we precompute context so the model searches less? | **Yes, and the server already computes the answer and throws it away.** `resolveAtInteraction` resolves the Lead before analysis starts; the model is then handed a 50-row candidate list instead. |

---

## 0. The reframe

The instinct that "the tools are too large" is correct. The location is not.

```
submit_intelligence_analysis   41,605 bytes   ███████████████████████████ 91.6%
search_ringcentral_calls            941
query_operational_records           499
get_call_transcript                 412
search_leads                        374
search_bookings                     317
list_number_activity                261
get_lead                            251
get_ringcentral_call                236
get_rep_identity                    210
get_booking                         186
get_intelligence_context            119
                              ─────────
all twelve                     45,411 bytes
eleven reads                    3,806 bytes
```

Measured from `vantage-movers-mcp/lib/intelligence/generated/intelligence-contract-v1.json` on 20 September 2026.

So: dropping tools is worth at most ~3 KB a step. Fixing how **one** schema is serialized is worth ~31 KB a step. Sections 1–3 follow that arithmetic; sections 4–5 answer the context and attachment questions, which turn out to be the same question twice.

---

## 1. The MongoDB MCP server is not in the intelligence path

`vantage-movers-mcp` hosts **two independent MCP endpoints** from one Next app. They share a repo and a `mongodb` dependency; they share no tool registry.

| | `/api/mcp` | `/api/intelligence-mcp` |
| --- | --- | --- |
| Handler | `createMcpHandler(registerVantageTools)` | `createIntelligenceHandler()` |
| Auth | `VANTAGE_API_SECRET` | scoped key **+** HMAC run token (`csi-run-token-v1`) |
| Registry | `lib/tools/register.ts` | `lib/intelligence/registration.ts` |
| Tools | 16: `vantage_health`, 6 Lead CRUD (**including `create_lead` / `update_lead` / `delete_lead`**), 8 `mongo_*` read tools | 12 `CSI_TOOLS`, read-only except submit |
| Mongo access | `lib/mongo.ts`, `lib/tools/mongo-ops.ts` | **none** — no Mongo client is imported |
| Resources / prompts | none | `csi://schemas/csi-envelope-v1`, `sales_intelligence_analyze_v1` |

The separation is enforced, not conventional. `app/api/mcp/route.ts` opens with:

```ts
if (isIntelligenceCredential(request)) return unauthorizedResponse(403, "RUN_SCOPE_DENIED");
```

and `isIntelligenceCredential` (`lib/auth.ts:104`) returns true for a run-token header, for the scoped CSI key, and for anything whose first segment decodes to `version: "csi-run-token-v1"`. A CSI run cannot reach `mongo_find`, `mongo_aggregate`, or `delete_lead` even if it tries.

The intelligence handler is also **request-local**: `createIntelligenceHandler` builds a fresh `createMcpHandler` per request, with the comment *"Never share a mutable SDK registry between identities or concurrent requests."* That is the right posture and it is what makes §2 cheap to implement.

**Recommendation: no change.** Do not merge, subset, or remove the Mongo endpoint on CSI's account — it is not on CSI's path. If the concern is blast radius rather than tokens, the remaining item is that `/api/mcp` exposes lead **writes** and raw `mongo_aggregate` under a single shared secret. That is a separate authorization review, not a CSI analysis concern, and it should not be folded into this work.

---

## 2. Dynamic tool selection already exists — and is hardcoded open

### 2.1 The mechanism

Per-run tool scoping is implemented at **three** layers and is already enforced:

| Layer | Code | Behaviour |
| --- | --- | --- |
| Run token claims | `auth.ts:259` → `tools: run.permitted_tools` | Signed into the HMAC run token |
| MCP registration | `registration.ts` → `if (!intelligenceContext().claims.tools.includes(name)) continue;` | A tool not in the claims is **never registered**, so it never appears in `tools/list` |
| Server call gate | `lease.ts:18`, `auth.ts:126` | A claim naming a tool outside `run.permitted_tools` → `RUN_SCOPE_DENIED` |

Narrowing the claim therefore narrows `tools/list`, which narrows the AI SDK `ToolSet` built in `runtime.ts:117`, which narrows every step's payload. No MCP change is required.

### 2.2 Why it does nothing today

`analysis/run.ts:90`, on every prepared run, conversation or number:

```ts
permitted_tools: [...CSI_TOOLS],
```

Twelve tools, unconditionally. The scoping machinery runs and admits everything.

### 2.3 The blocker

One assertion has to move first. `runtime.ts:71`:

```ts
if (definitions.nextCursor || definitions.tools.length !== CSI_TOOLS.length ||
    definitions.tools.some(t => !(CSI_TOOLS as readonly string[]).includes(t.name)))
  throw new IntelligenceRuntimeError("contract_mismatch");
```

It asserts **exactly twelve**. Narrow `permitted_tools` today and every run dies `contract_mismatch`. The fix is to assert the run's own allowlist instead of the global constant: the listed set must be a subset of `CSI_TOOLS` **and** set-equal to `run.permitted_tools`. That is stricter than today, not looser.

### 2.4 What a narrowed set is worth

| Run shape | Tools | Bytes |
| --- | --- | --- |
| Today, every run | 12 | 45,411 |
| Conversation run, minimal | `get_intelligence_context`, `get_call_transcript`, `list_number_activity`, `submit` | 42,397 |
| Hypothetical reads-only | 11 | 3,806 |

**~3 KB, or 6.6%.** Worth doing for precision and least privilege; not worth doing for tokens. Anyone who ships only this will report that it "didn't help."

### 2.5 Recommended per-run allowlists

Derive `permitted_tools` at `prepareIntelligenceRun` from what the run actually is:

| Run | Tools |
| --- | --- |
| Conversation, attribution resolved | context, transcript, activity, submit |
| Conversation, attribution ambiguous or unlinked | the above **+** `search_leads`, `get_lead`, `search_bookings`, `get_booking` |
| Number synthesis | context, transcript, activity, `get_rep_identity`, submit |
| Owner `reanalyze` with `original_evidence` | replay set only — the parent's captured tools |
| `query_operational_records`, `search_ringcentral_calls`, `get_ringcentral_call` | **opt-in**, only when preflight returned a non-empty `missing_ranges` the live provider could close |

The last row matters beyond tokens: `search_ringcentral_calls` is the only live provider read on the analysis path (13 §5.5, up to 20 Detailed pages over 31 days). Today it is offered to every run, including runs with complete captured coverage that have no reason to touch RingCentral at all.

Pair this with `runtime.ts:165`, which narrows `activeTools` **only after** a schema failure. Narrow it on the first pass too — but note the code's own caveat at `runtime.ts:124`: *"activeTools limits discovery, not SDK execution of an emitted hidden tool."* `activeTools` is a context-size hint. The authority gate is `permitted_tools`. Set both; rely on the second.

---

## 3. The real size lever: the submit schema is 91.6% duplication

### 3.1 What is actually in there

`submit_intelligence_analysis.inputSchema` breaks down as:

| Property | Bytes |
| --- | --- |
| `findings` | **39,229** |
| `next_step_suggestion` | 840 |
| `owner_instruction_assessments` | 531 |
| `summary` | 459 |
| `schema_version` | 43 |

`findings.items` is a **16-branch `oneOf`** with **zero `$defs`**. Measured directly:

- 16 branches, ~2,242–2,352 bytes each
- distinct branch shapes **ignoring `kind` and `value`: 1**
- the shared shape: 2,015 bytes, of which `evidence` alone is **1,253**

So the identical `key`, `claim`, `basis`, `actor`, `speaker_ref`, `action_status`, `clarity`, `evidence[]` and `confidence` sub-schemas are emitted **sixteen times**. The evidence schema alone accounts for roughly **20 KB of pure repetition**, re-sent on every model step, and counted again by `contextTokenCeiling` — which is `Buffer.byteLength(JSON.stringify(...))` over `{prompt, messages, tools}` (`runtime.ts:39`).

### 3.2 The fix

Emit `$defs` and `$ref` from the generator. Same Zod source of truth, same validation semantics, same digest discipline — only the serialization changes.

```
shared finding base ($defs)      ~2,015
16 × (kind const + value + $ref)  ~6,100
                                 ──────
findings                         ~8,100   (was 39,229)
submit tool                     ~10,500   (was 41,605)
all twelve tools                ~14,400   (was 45,411)
```

Roughly **68% off the tool payload on every step**, before any tool is dropped. Combined with §2.5, a conversation run ships on the order of **11 KB instead of 45 KB** — across eight steps, ~270 KB of byte ceiling returned.

Three things to verify while doing it, none of them blocking:

1. **`z.fromJSONSchema` must resolve `$defs`/`$ref`.** Both the MCP layer (`registration.ts` `toolSchemas`) and the worker (`runtime.ts:119`) rehydrate the generated JSON Schema through it. If local `$ref` resolution is not supported, the fallback is §3.3.
2. **The digest changes.** `SCHEMA_DIGEST` is `sha256` over canonicalized `envelope_schema`, and `runtime.ts:69` compares it to the run's pinned `schema_digest`. Re-pinning is expected; `original_evidence` reruns of pre-change runs will correctly refuse (`ORIGINAL_EVIDENCE_UNAVAILABLE`). Plan the cutover, do not fight it.
3. **Some providers flatten `$ref` for structured output.** If the Gateway expands refs before billing, the wire win survives but the token win may not. Measure one run's reported `usage.inputTokens` before and after rather than assuming.

### 3.3 Fallback if `$ref` cannot be used

Give the **model** a thin submit tool — `idempotency_key` plus `envelope` as a loosely typed object — and keep the full schema where it already lives: the `csi://schemas/csi-envelope-v1` resource. The server's `superRefine` + `validateEnvelopeEvidence` remain the real gate; they already catch everything JSON Schema cannot express (15 §3.1).

This trades structural pre-validation for size. It is only safe alongside 15's Pass D (a compact valid-envelope skeleton in the pinned prompt), because today the SDK-side schema is what stops some malformed submits before they burn one of the two attempts.

---

## 4. A tool catalog resource, and "tool search"

### 4.1 What MCP gives us here

The intelligence server already registers one resource and one prompt. Adding a **catalog resource** — `csi://catalog/tools`, a short list of tool names, one-line purposes, and when each is worth calling — is straightforward and cheap.

The catch: **`ToolLoopAgent` does not surface MCP resources to the model.** `runtime.ts` reads the schema resource itself, for digest verification, and never puts it in the message list. A resource the model cannot see is documentation for us, not context for it.

So "let the model go deeper if it needs to" has two viable shapes, and one that is not worth it:

| Shape | Cost | Verdict |
| --- | --- | --- |
| **A. Inline catalog in the prompt.** A ~400-byte table of the tools *not* granted this run, with the sentence that they are unavailable and why. | ~400 bytes, zero steps | **Recommended.** Honest about the boundary; no round trip. |
| **B. A `describe_tools` meta-tool.** The model calls it to get the full schema of a tool it wants. | ~200 bytes advertised; **one step** per use, plus the schema it returns | Only if B's step is cheaper than always-on advertising. With §3 done, it is not. |
| **C. Escalation tool.** One `request_additional_evidence(reason)` that the *server* answers by widening `permitted_tools` and re-preparing. | one step + a run re-prepare | **No.** Re-preparing a run mid-loop breaks the pinned-prompt/digest contract for no measured gain. |

### 4.2 Why B is usually a trap here

A tool search pays off when the catalog is large and each schema is big — exactly the situation §3 removes. After `$defs`, every read tool is 119–941 bytes. Advertising all eleven costs 3.8 KB; one `describe_tools` round trip costs a full context replay of the accumulated message list, which by step four is far more than 3.8 KB. The loop has **8 steps and 2 submit attempts**; spending one on tool discovery is expensive.

**Recommendation.** Do A. Register the catalog resource too — it is nearly free and gives Owner tooling and future non-`ToolLoopAgent` clients something to read — but do not build a tool-search step into the loop. Revisit only if the tool count grows past ~20 or a genuinely large tool returns.

---

## 5. Precomputing context: the server already knows the answer

This is the highest-value section in the document.

### 5.1 The work is already done, then discarded

Before an analysis job is ever created, `loadEligibilityInputs` (`conversations/eligibility.ts:63`) loads every non-rejected attachment edge on the Contact Number and runs `resolveAtInteraction` (`attachment/suggest.ts:57`). That returns:

```ts
{ lead_ref, certainty, certainty_label, lead_effects_allowed,
  blocked_reason, applicable_leads }
```

That is a deterministic, evidence-backed answer to *"which Lead is this call about, and how sure are we?"* — computed from pinned identity evidence and time windows, by pure code, with no model involved.

What is persisted from it? `LeadConversation.analysis_eligibility` stores `{ eligible, status, missing_inputs, scope, reasons, decided_at, policy_version }` (`models/LeadConversation.ts:172`). `scope` is the string `"lead"` or `"number"`.

**`lead_ref` and `certainty` are not stored.** The identity of the Lead — the answer — is thrown away.

Then `runtime.ts:104` runs, unconditionally, on every run:

```ts
await readPages("get_intelligence_context", {});
await readPages("list_number_activity", { limit: 50 });
await readPages("search_leads",    { limit: 50 });
await readPages("search_bookings", { limit: 50 });
```

`search_leads` returns everything in `scope.lead_refs` **plus every Lead whose phone matches the Contact Number** (`leadRelevance`, `reads.ts:98`). The model is handed up to 50 Lead candidates and up to 50 Bookings and asked to work out which one the call is about — a question the server answered deterministically, minutes earlier, and deleted.

### 5.2 What this costs

- **Tokens.** Up to 100 evidence records the run does not need, in the citation inventory *and* again in the full-page JSON dump (15 §5 finding 2).
- **Steps.** A model that is unsure re-reads. Every re-read is a full context replay.
- **Quality.** The model can pick a *different* Lead than the server's attribution. The server then refuses the resulting effect (`effects.ts:78`) — the model did work that was structurally guaranteed to be discarded.
- **Mongo.** `readBookings` (`reads.ts:135`) re-runs `readLeads(scope, { limit: 100 })` internally and requires `complete`. So preflight executes the lead query **at least three times** per run — and that query is §6.1's collection scan.

### 5.3 Recommendation — resolve first, hand over the answer

1. **Persist the attribution.** Extend `analysis_eligibility` with `lead_ref`, `certainty` and `blocked_reason`. It is already computed at that exact point; this is a store, not a new query.
2. **Add a resolved-subject block to `get_intelligence_context`.** Not a new tool — a new object on the page the model already reads first:

   ```
   resolved_subject: {
     lead_ref, certainty, certainty_label,
     lead_effects_allowed, blocked_reason,
     outreach_record_id, booking_refs[],
     basis: "attachment_identity" | "attachment_phone_window" | "owner_confirmed" | "unresolved"
   }
   ```
   Cite it like any other record so it stays inside the snapshot-membership contract. The model is told the answer and its confidence, rather than being asked to infer both.
3. **Make discovery conditional on the resolution.** When `lead_ref` is resolved and not ambiguous, drop `search_leads` / `search_bookings` from preflight **and** from `permitted_tools`; fetch the one Lead and its Bookings by id. When attribution is `ambiguous_attachment` or `competing_attached`, keep them — that is the case where discovery is the actual job.
4. **Keep the honest-uncertainty rule.** `blocked_reason: "unlinked"` must stay a first-class, stated outcome. Precomputing must not turn "we do not know" into a confident guess. This is the same discipline as `unknown ≠ zero` elsewhere in the pack.

Expected effect: the common conversation run — one call, one Lead, one transcript — stops carrying a 100-row discovery corpus and stops advertising four discovery tools. That is a far larger token win than §2 and it improves the answer.

---

## 6. Lead matching and attachment logic

Four machines meet here: `sources.ts` (evidence extraction), `suggest.ts` (pure policy), `store.ts` (persistence and fan-in), `refresh.ts` (scheduling). The policy layer is clean, pure and well-factored. The problems are in the layers around it.

### 6.1 `leadRelevance` forces a collection scan on every model lead read

`reads.ts:98`:

```ts
const phone = normalizePhoneNumberForMatch(scope.e164);
const clauses = [{ _id: { $in: scope.lead_refs… } }];
if (phone) clauses.push(...FORM_LEAD_CONTACT_PHONE_PATHS.map(path => ({
  [path]: path.includes("normalized_")
    ? phone
    : new RegExp(`^${phone.length === 10 ? "(?:\\+?1\\D*)?" : "\\+?"}\\D*${phone.split("").join("\\D*")}\\D*$`)
})));
return { $or: clauses };
```

`FORM_LEAD_CONTACT_PHONE_PATHS` (`services/search/leadBrowseShared.ts:54`) is six paths: three `normalized_*` and three raw. The normalized branches are equality and are indexable. The three raw branches build an anchored regex with `\D*` **between every digit** — unindexable by construction. Because this is an `$or`, one unindexable branch degrades the whole predicate to a **COLLSCAN of `form_leads` and `call_leads`** — three times per run (§5.2).

The three regex branches are also **redundant**: `normalized_phone_number` is derived from `phone_number` by a pre-save hook (`FormLead.ts:189`, `CallLead.ts:242`). The regex re-derives, at query time and without an index, a value the document already stores.

**Recommendation.** Drop the three raw-phone branches. The `$or` becomes `_id $in` plus three indexed equality checks. Where a legacy document predates the hook, repair it in a backfill — not in every query, forever. Index `granot_contact_snapshot.normalized_phone_number` on both models; `ingested_contact_snapshot.normalized_phone_number` is already indexed on CallLead only. This is the same index and the same root cause as [14](14-call-log-and-number-search-efficiency.md) §3 — one fix serves both call sites.

### 6.2 Form Leads can never reach `exact`, and that silently caps effects

`exactSource` (`suggest.ts:19`) is `["call_lead_ringcentral_identity", "ringcentral_call_adoption"]`, and `exactEvidence` (`sources.ts:52`) opens with:

```ts
if (model !== "CallLead" || !rc) return [];
```

So exact identity evidence is **structurally unavailable to Form Leads**. A Form Lead can only be matched by phone-in-window, which `suggest()` grades `state: "candidate"`, `certainty: "likely"`.

Two places then refuse "likely":

- `analysis/sources.ts:94` — the conversation run binds to a Lead Outreach Record only when `certainty !== "likely"`; otherwise it falls through to the **Number Review** record.
- `outreach/effects.ts:78` — a Lead-scoped effect requires an edge in state `attached` **and** `certainty !== "likely"`.

Consequence: for a Form Lead with an inbound call — which is Attention **band 2**, *"No call yet after form submission"*, the largest cohort on the desk (ATTENTION-PROJECTION §3) — the analysis runs, produces findings, and then **cannot write Lead outreach effects** without an Owner confirmation.

This may well be deliberate evidence conservatism: "Likely" is not proof, and the Owner-confirm path exists. But it is not stated anywhere in the pack, and it produces a confusing surface: a completed analysis whose effects quietly land on the Number Review instead of the Lead.

**Recommendation.** Decide and then write it down, rather than changing code first.

- If intentional: say so in the Outreach and analysis Service cards, and surface it in the Owner UI as a named state (*"Attach this Lead to enable automatic follow-ups"*) with the confirm action inline. Today the ceiling is invisible.
- If not: the honest way to raise a Form Lead above "likely" is corroboration, not a looser threshold — for example phone-in-window **plus** a matching `inbound_route_id` for that Lead's source, or a name match against `interaction.parties[].name_raw`. That is a policy change to `suggest.ts` and belongs in a reviewed slice with fixtures, never as a quiet constant edit.

### 6.3 Attachment windows make ambiguity the default for repeat callers

`leadWindow` (`suggest.ts:23`):

| Model | Before lead timestamp | After |
| --- | --- | --- |
| FormLead | 36 hours | **14 days** |
| CallLead | 12 hours | 12 hours |

A Form Lead's phone evidence therefore covers a **15.5-day** window. `ambiguityFanIn` (`suggest.ts:34`) marks an edge ambiguous when any *other* non-rejected edge has overlapping non-exact evidence. Two Form Leads from the same phone inside 15.5 days — a repeat customer, a household, a re-submitted quote form, a shared office line — make **both** ambiguous. `resolveAtInteraction` then returns `blocked_reason: "ambiguous_attachment"`, `lead_effects_allowed: false`, and eligibility records `ambiguous_lead_context`: the call is analyzed but nothing can bind.

Combined with §6.4, this is a ratchet: ambiguity accumulates and never clears itself.

**Recommendation.** Do not simply shorten the window — 14 days is presumably a real observation about how long after a form submission a customer calls back. Instead make the tie-break evidence-driven, in the pure layer where it can be tested:

- Prefer the edge whose lead timestamp is **nearest** the interaction when two phone-window edges overlap, and grade the loser `unsure` rather than making both ambiguous.
- Let a non-overlapping signal break the tie: matching Job Number, matching `source_granularity_id` against `inbound_route_id`, or a `parties[].name_raw` match.
- Keep genuine ambiguity — two leads equidistant with no distinguishing evidence — as ambiguous. That is the honest answer.

Whatever is chosen, it is a `suggest.ts` change with fixtures, and it should ship with a count of how many existing edges change state.

### 6.4 Evidence is append-only, so stale edges never decay

`persistLeadAttachments` (`store.ts:58`) seeds `pairs` from current phone evidence, then adds every prior pair with **empty** new evidence *"Refresh display caches even when the current phone has moved; identity evidence is append-only."* The empty-evidence branch hits `if (!evidence.length) { … continue; }` and the edge is left exactly as it was.

So when a Lead's phone is corrected, the old edge is never retired — a new edge is added beside it. Over time a Contact Number accumulates edges to Leads it no longer has any current evidence for, and every one of them feeds `ambiguityFanIn`.

Append-only identity evidence is the right invariant; it is what makes historical attribution reproducible. The gap is that there is no **decay** concept next to it.

**Recommendation.** Keep evidence immutable and add a derived staleness marker: an edge whose evidence contains no source still present on the current Lead document is `superseded`. Exclude `superseded` from `ambiguityFanIn` and from `applicable_leads` at interactions **after** the supersession time, while leaving it fully intact for interactions inside its original window. History stays reproducible; today's desk stops being poisoned by a phone number that changed a year ago.

### 6.5 Fan-in is O(n²) and write-amplifies a no-op

Three smaller items in the same file, worth fixing in the same pass:

1. **`lockNumber` writes before it knows there is anything to write.** `store.ts:19` does a `findOneAndUpdate` with `$inc: { revision: 1 }` for **every pair considered**, and `unchangedNumber` then issues a second `updateOne` to put the revision and `updatedAt` back. Two writes to discover nothing changed. Compute the proposed edge first; take the lock only when a write is actually required.
2. **`fanInNumber` re-reads all edges and runs `ambiguityFanIn` per pair.** Inside a scan over many leads on one number this is quadratic. Run fan-in **once** at the end of the job, not once per pair.
3. **`assertIndexes` on every call.** `store.ts:60` issues a `listIndexes` server command per `persistLeadAttachments` — 250 per scan page. Memoize per collection per process ([14](14-call-log-and-number-search-efficiency.md) §10).

Under the current corpus-scanning scheduler (14 §3) these multiply against every Lead in the database. Fixing the scheduler is the larger win; these are the reason the inner loop is expensive even after it.

---

## 7. Recommended sequencing

Ordered by measured return, not by section order. Each pass is independently shippable.

### Pass A — the 31 KB (generator only)

| Work | § |
| --- | --- |
| Emit `$defs`/`$ref` for the shared finding shape; regenerate `intelligence-contract-v1.json` | 3.2 |
| Confirm `z.fromJSONSchema` resolves local `$ref` on both MCP and worker sides | 3.2 |
| Re-pin `schema_digest`; accept that pre-change `original_evidence` reruns refuse | 3.2 |

Acceptance: `submit_intelligence_analysis` under 12 KB; all twelve tools under 15 KB; one live run's reported `usage.inputTokens` measured before and after.

Regenerate with `scripts/dev_ops/generate-csi-intelligence-contract.ts`.

### Pass B — hand the model the answer

| Work | § |
| --- | --- |
| Persist `lead_ref` / `certainty` / `blocked_reason` on `analysis_eligibility` | 5.3 |
| Add `resolved_subject` to `get_intelligence_context`, cited like any record | 5.3 |
| Skip `search_leads` / `search_bookings` in preflight when attribution is resolved | 5.3 |
| Drop the three raw-phone regex branches from `leadRelevance`; index the Granot snapshot path | 6.1 |

Acceptance: a resolved single-Lead conversation run captures no discovery pages; `explain()` on the lead query shows an index scan; first-submit rate does not regress on the three desk fixtures.

### Pass C — least privilege and precision

| Work | § |
| --- | --- |
| Derive `permitted_tools` per run shape | 2.5 |
| Change `runtime.ts:71` to assert the run's allowlist instead of `CSI_TOOLS.length` | 2.3 |
| Narrow `activeTools` on the first pass, not only after a schema failure | 2.5 |
| Make `search_ringcentral_calls` opt-in on unresolved `missing_ranges` | 2.5 |
| Inline the short unavailable-tools note; register `csi://catalog/tools` | 4.1 |

Acceptance: a conversation run lists four tools; a run with complete captured coverage cannot reach RingCentral at all.

### Pass D — attachment quality (needs a decision first)

| Work | § |
| --- | --- |
| **Decide** whether the Form Lead "likely" effect ceiling is intended; document or change it | 6.2 |
| Evidence-driven tie-break instead of blanket ambiguity | 6.3 |
| Derived `superseded` marker for edges with no current source | 6.4 |
| Lock-after-decide; fan-in once per job; memoize `assertIndexes` | 6.5 |

Acceptance: a repeat caller with two Form Leads in 14 days resolves to one Lead with stated certainty, or stays ambiguous for a stated reason. Report the count of existing edges whose state changes before shipping.

---

## 8. What this document does not change

- **Snapshot membership stays mandatory.** Everything proposed here is cited from captured pages; `resolved_subject` is no exception.
- **Server-side validation stays authoritative.** `superRefine` and `validateEnvelopeEvidence` remain the gate even if §3.3 thins the SDK-side schema.
- **The run-token authority model is unchanged.** Narrowing `permitted_tools` tightens it; `activeTools` is never treated as a security boundary.
- **No `/api/mcp` change is proposed.** Its lead-write and `mongo_*` surface is out of scope here and belongs in its own authorization review.
- **`suggest.ts` policy is not edited on the strength of this document.** §6.2 and §6.3 are decisions to take, with fixtures, not constants to tune.
- **No production flag, model, or budget change is implied.**

---

## 9. Code map

| Concern | Path |
| --- | --- |
| Intelligence MCP endpoint | `vantage-movers-mcp/app/api/intelligence-mcp/route.ts`, `lib/intelligence/handler.ts` |
| Per-run tool registration and resource/prompt | `vantage-movers-mcp/lib/intelligence/registration.ts` |
| Run-token claims and tool allowlist | `vantage-movers-mcp/lib/intelligence/auth.ts` |
| Mongo / lead-CRUD endpoint (separate) | `vantage-movers-mcp/app/api/mcp/route.ts`, `lib/tools/register.ts`, `lib/tools/mongo-ops.ts` |
| Credential separation | `vantage-movers-mcp/lib/auth.ts` (`isIntelligenceCredential`) |
| Generated tool + envelope schemas | `vantage-movers-mcp/lib/intelligence/generated/intelligence-contract-v1.json` |
| `permitted_tools` assignment | `src/services/salesIntelligence/analysis/run.ts` |
| Token issue and call gate | `src/services/salesIntelligence/auth.ts`, `analysis/lease.ts` |
| `tools/list` assertion, preflight, agent loop | `src/services/salesIntelligence/analysis/runtime.ts` |
| Model-facing reads and lead relevance | `src/services/salesIntelligence/analysis/reads.ts` |
| Attribution consumed for fingerprint and effects | `src/services/salesIntelligence/analysis/sources.ts`, `outreach/effects.ts` |
| Eligibility and attribution resolution | `src/services/salesIntelligence/conversations/eligibility.ts` |
| Attachment policy (pure) | `src/services/salesIntelligence/attachment/suggest.ts` |
| Attachment evidence extraction | `src/services/salesIntelligence/attachment/sources.ts` |
| Attachment persistence and fan-in | `src/services/salesIntelligence/attachment/store.ts` |
| Attachment scheduling | `src/services/salesIntelligence/attachment/refresh.ts` |
| Stored eligibility shape | `src/models/LeadConversation.ts` |
| Lead phone paths | `src/services/search/leadBrowseShared.ts`, `src/utils/phone.ts` |
