# Form Lead Granot Matching Alignment

Handoff for aligning **Granot HTTP automation** (`vantage-main-server` collector) and the **browser extension** Form Leads workflow (`granot_sync_extensions_and_services`).

Goal: one identity model, one candidate priority order, and the same syncable / mutation rules on both paths — including a dual regime where Granot `ref_no` may contain either the provider reference **or** a Mongo `_id`.

> Implementation status (2026-08-12): the shared server resolver, extension
> integration, source-gated fallback, aligned match methods, Admin provenance,
> and server posting correction described below are implemented. Sections
> labeled “current logic” preserve the pre-alignment investigation for context.

---

## 1. Identity vocabulary (do not conflate)

| Name | Where it lives | Meaning |
| --- | --- | --- |
| Provider / WordPress `ref_no` | Mongo `FormLead.ref_no` | Click/sub/source id from the lead provider (`DT_…`, `Mob_…`, `tz…`, `MS-…`, etc.). Used for sheets + exact Granot row matching. |
| Mongo `_id` | Mongo `FormLead._id` | Canonical Vantage document id (24-hex ObjectId). Used for `GET`/`PATCH /form-leads/:id`. |
| `lid` | Mongo `FormLead.lid` | Internal `LID` + 13 hex. **Not** a Granot list-column identity. |
| Granot POST `leadno` | Wire field on Hello Moving gateway | Granot docs: “LeadID, SubID or ClickId from the provider”. Becomes the CRM web list column **`ref_no`**. |
| Granot POST `notes` | Wire field | Granot docs: “Notes populates as customer remarks.” Optional place for `lid` if still desired; never a matching key. |
| Granot list `source` | Report column | CRM source label for the row (e.g. `Top10 Forms`, `TBM Forms Prime`). Maps to Vantage `source_company` slug for tie-breaks / gates. |

### Live posting reality (as of investigation)

- WordPress owns Granot posting for most form sources (`post_to_granot: false` on those Mongo leads).
- Correct WordPress mapping: **`leadno` = provider `ref_no`**, optional **`notes` = `lid`**. There is no Granot field named `lid`.
- Top10 booked rows show Granot `ref_no` equal to Mongo `FormLead.ref_no`.
- TBM Forms Prime rows often have **empty** Granot `ref_no` while Mongo still has `tz…` refs → exact identity is unavailable; fallbacks are required.
- Server CRM path (`formLeadPayload`) now posts `leadno = ref_no` and optional `notes = lid`. Matching retains the Mongo `_id` compatibility step for historical/experimental rows.

---

## 2. Two update paths (what each is)

### A. Granot HTTP automation (server)

- Code: `src/services/granotHttpCollector/formWorkflow.ts` (+ `runWorkflow.ts` apply).
- Collects Booked Jobs + Follow Up Estimates per source label, builds an immutable plan, owner approves actions, worker applies.
- Form identity docs already state: exact `Granot ref_no === FormLead.ref_no`, never `lid` / `_id` / `normalized_lid` (see `docs/granot-http-automation.md` and collector HANDOFF).
- Call-lead operation is separate and must not interpret Granot `ref_no`.

### B. Browser extension Form Leads

- Code: `granot_sync_extensions_and_services/src/workflows/form-leads/`
  - Parser: `src/parsers/granot/form-leads.ts`
  - Preview: `preview.ts`, `preview-model.ts`, `fallback-resolve.ts`
  - Sync eligibility / payloads: `payloads.ts`, `sync.ts`
- Scans the same Granot tables in-page, previews against Vantage, patches via `PATCH /api/v1/form-leads/:id`.

These paths must converge on matching + syncable rules. Today they do not.

---

## 3. Current logic — server automation

### Match order (`planRow`)

1. **Exact `FormLead.ref_no`** when Granot `ref_no` is non-empty  
   - `find({ ref_no, duplicate: { $ne: true } })`  
   - 0 hits → continue  
   - 1 hit → `match_method: "ref_no_exact"`  
   - \>1 hit → `conflict` / `duplicate_exact_ref` (no fallback)

2. **Fallback search** via `searchFormLeads({ phone, email, name })`  
   - Duplicates excluded by search default  
   - `selectGranotFormFallback`:  
     - Keep top score band  
     - Prefer candidates whose `source_company` equals `resolveSourceCompanyFromLabel(sourceLabel)`  
     - Then prefer `quoted` aligned with Granot `prior` (`1`/`5` → true, `0` → false)  
     - Exactly one left → `match_method: "fallback"`; else `conflict` / `no_match`

3. **Never** matches Granot `ref_no` to `_id` or `lid`.

### Syncable / mutation behavior (after a lead is chosen)

Patch builder (`buildGranotFormPatch`):

| Granot signal | Mutation |
| --- | --- |
| `prior` is `1` or `5` | Set `quoted: true` and `cubic_feet` from `est_cf` when parseable |
| `prior` is `0` or other | Do **not** set quoted/cubic from this row |
| from / to / zips | Fill **only missing** compatible city/state/zip fields |
| `user` / `rep` | Set `receiver_agent` **only if currently empty** and CRM username uniquely resolves |
| `source` / source company | **Never** in the patch |

Classifications: `update` | `unchanged` | `conflict` | `no_match` | `invalid`.

Apply path re-checks expected values + duplicate quarantine; drift → receipt, no blind overwrite.

### Source-company behavior today (server) — important nuance

- **`source_company` is never overwritten.** Patches do not include it. That part of the desired safety is already true.
- Source company is **only a fallback tie-break**, not a hard gate:
  - If phone/email/name search returns **one** lead from a **different** `source_company`, the server **will still select it and may update** quoted/cubic/location/receiver.
  - Exact `ref_no` match also **does not** require source-company equality (reasonable when provider refs are globally unique).

So: “different source company should not update that lead” is **desired for fallback identity**, but **not current** for a unique wrong-source phone/email hit.

---

## 4. Current logic — browser extension

### Parser gate (`form-leads.ts`)

A row is `syncable` only when:

1. Granot `ref_no` matches `MONGO_OBJECT_ID_RE` (`/^[a-f\d]{24}$/i`), and  
2. `prior` is `0`, `1`, or `5` (quoted derived for `1`/`5`).

Anything else with a non-ObjectId / empty `ref_no` becomes `invalid_ref_no` (reason: “Missing or invalid Mongo ObjectId in ref_no column”).

This is the root misalignment with production Top10 rows (`DT_…` / `Mob_…`) and with the server’s `FormLead.ref_no` exact matcher.

### Preview order (`preview.ts`)

1. **Direct Mongo id** if `status === "syncable"` **or** ObjectId-shaped `ref_no`  
   - `GET /api/v1/form-leads/:id` with Granot `ref_no` as `:id`  
   - Success → `matchMethod: "mongo_id"`  
   - Duplicate quarantine → try fallback if phone/email present  
   - 404 + phone/email → fallback

2. **Fallback** for `invalid_ref_no` (or failed id lookup)  
   - `POST /api/v1/form-leads/search` with **phone and/or email only**  
   - API client already supports `ref_no` in the body, but preview **does not send it**  
   - 1 match → `found_by_fallback` / `phone_and_email`  
   - Multiple / ambiguous → conflict; `pickResolvableFallbackMatch` may auto-pick one via:  
     1. unique equal `ref_no`  
     2. unique matching `source_company` (local label map in `fallback-resolve.ts`)  
     3. unique quoted alignment with `prior`  
   - Conflict-resolved rows stay conflict-messaging but can become syncable

3. Sync PATCHes `resolvedVantageId` (never the raw Granot `ref_no` string after fallback).

### Syncable rules (`payloads.ts`)

| Concern | Rule |
| --- | --- |
| Quote / cubic fields | Only when Granot `prior` is `1` or `5` |
| Prior `0` | Not field-syncable; may still sync **receiver_agent** enrichment if a lead was found and CRM username is present |
| Direct row sync | Parser `syncable` + prior `1`/`5` |
| Fallback row sync | `phone_and_email` match with resolved id + prior maps to quoted + state `found_by_fallback` or resolvable `conflict` |
| Locations | Fill-only missing compatible fields (parity with server) |
| Receiver | Only when empty; match CRM username → Agent |
| `source_company` | **Not** in `FormLeadUpdatePayload` — never overwritten by extension sync |

### Source-company behavior today (extension)

Same nuance as server:

- Never overwrites `source_company`.
- Uses source company only as a **multi-match tie-break**.
- A **single** phone/email hit from another source company is accepted as `found_by_fallback` and can be synced.

Also: extension’s Granot-label → slug map lives locally in `fallback-resolve.ts` and can drift from server `resolveSourceCompanyFromLabel` / `SOURCE_LABEL_TO_COMPANY`. Alignment work should prefer one shared vocabulary (server catalog or shared constants).

---

## 5. Side-by-side gap summary

| Concern | Server automation | Extension today | Target |
| --- | --- | --- | --- |
| Exact provider `ref_no` | First-class | Missing (ObjectId-only) | First-class on both |
| Mongo `_id` as Granot `ref_no` | Explicitly rejected | First-class | Second-class direct path after field exact |
| Search includes `ref_no` | Exact query separate; fallback search omits `ref_no` | Fallback omits `ref_no` | Field exact first; fallback may include `ref_no` for scoring |
| Match `lid` | Forbidden | Forbidden | Keep forbidden |
| Phone/email/name fallback | Yes | Phone/email (name not sent) | Align (include name like server) |
| Source company on fallback | Soft prefer | Soft prefer | **Hard gate** for fallback (see §7) |
| Overwrite `source_company` | Never | Never | Keep never |
| Prior `1`/`5` → quoted + cubic | Yes | Yes | Keep |
| Prior `0` quote/cubic push | No | No | Keep |
| Fill-only locations | Yes | Yes | Keep |
| Receiver only if empty | Yes | Yes | Keep |
| Duplicate quarantine | Excluded | Excluded | Keep |
| Multi exact `ref_no` | Conflict | N/A today | Conflict on both |

---

## 6. Syncable nature (how to talk about it)

“Syncable” means different things today. Align the language:

### Identity-resolved

A Granot row has a single non-quarantined Vantage `FormLead` chosen by the match ladder. Without this, no field sync.

### Field-syncable (quote / cubic / location enrichment from prior)

- Granot `prior` ∈ `{1, 5}` → may set `quoted` / `cubic_feet` and location fills.
- Granot `prior` `0` → must **not** push quoted=false or placeholder `est_cf` into Vantage.
- Unsupported / missing prior → no quote/cubic; may still allow receiver-only enrichment if product wants parity with current extension.

### Receiver-enrichment-syncable

Lead identity resolved, `receiver_agent` empty, CRM username uniquely maps to an Agent. Independent of prior `1`/`5` on the extension today; server includes receiver in the same patch builder.

### Plan / UI syncable

- Extension: parser status + preview state + prior rules drive default selection.
- Server: plan action `classification` (`update` / `unchanged` / …); call path has a separate `syncable` boolean. Form path should expose an equivalent “eligible to apply” signal once matching is fixed so owner UIs stay consistent.

---

## 7. Desired robust matching strategy (both paths)

Assume at any moment Granot `ref_no` may be:

- provider id (correct WordPress / Top10), **or**
- Mongo `_id` (owner experiment / server CRM posting / future mistake), **or**
- empty (current TBM hole).

### Priority ladder (per row)

1. **Non-empty Granot `ref_no` → exact `FormLead.ref_no` match**  
   - Exclude `duplicate: true`.  
   - 1 hit → accept (`ref_no_exact`).  
   - \>1 hit → **conflict** (do not fall through).  
   - Source-company mismatch on exact ref: treat as **conflict or owner-visible warning**, but default recommendation is still “ref wins” only when refs are globally unique. Prefer conflict if the matched lead’s `source_company` ≠ report source slug **and** product wants strict source isolation even on exact refs.  
   - **Recommended default for v1 alignment:** exact `ref_no` wins regardless of source (provider ids should be unique); log/surface source mismatch for review.

2. **If (1) misses and value looks like ObjectId → `GET /form-leads/:id`**  
   - Success + non-duplicate → accept (`mongo_id`).  
   - This covers Mongo `_id` written into Granot `leadno`/`ref_no`.  
   - Do **not** invert this ahead of field exact match (provider ids must not be forced through ObjectId parsing).

3. **Fallback search** when still unmatched:  
   - Inputs: phone, email, and name (parity with server).  
   - Optionally include Granot `ref_no` in search body so server scoring (`ref_no` weight 100) can reinforce, but **do not** treat scored search as a substitute for step 1’s exact unique query.  
   - Exclude duplicates.

4. **Fallback source-company hard gate (recommended change)**  
   - Resolve Granot row `source` → Vantage `source_company` slug (shared server map).  
   - After scoring, **drop** candidates whose `source_company` ≠ that slug.  
   - If none remain → `no_match` (do **not** update a different source’s lead).  
   - If multiple remain → apply quoted/prior tie-break; still multiple → `conflict`.  
   - This is the rule that implements: *phone/email match but different source company must not update that lead.*  
   - Confirm: neither path overwrites `source_company` even if a wrong lead were selected; the hard gate prevents the selection itself.

5. **Never** match Granot `ref_no` to `lid` / `normalized_lid`.

6. **Empty Granot `ref_no`** → skip 1–2; go straight to gated fallback (current TBM case).

### Mutation rules (unchanged intent, both paths)

After identity resolution:

- Prior `1`/`5`: `quoted=true`, sync `cubic_feet` when numeric.
- Prior `0`: no quote/cubic write from CRM defaults.
- Locations: fill only empty/compatible fields.
- Receiver: only if empty + unique CRM username match.
- **Never** patch `source_company`, `lid`, or `ref_no` from Granot sync.
- Preserve booking links; do not clear `booked`.
- Refuse duplicate-quarantined targets.

### Parser / eligibility changes (extension)

- Stop treating “non-ObjectId `ref_no`” as identity failure.
- Treat non-empty `ref_no` as **identity candidate** (field exact → then ObjectId GET).
- Keep prior `0/1/5` validation separate from identity validity.
- Rename statuses if needed (`invalid_ref_no` → something like `needs_fallback` / `unresolved_identity`) so UI copy matches reality.

### Server automation changes

- Add step 2 (`mongo_id`) after exact `ref_no` miss when ObjectId-shaped — **or** document intentional refusal and rely only on provider `ref_no` once WordPress/server posting is fixed. Given the dual-regime requirement in this handoff, **add the ObjectId GET step** so both paths behave the same.
- Tighten fallback with the source-company hard gate.
- Keep exact multi-ref conflicts.

---

## 8. Recommended match_method vocabulary (aligned)

Use the same enum (or mapping) on both paths:

| `match_method` | Meaning |
| --- | --- |
| `ref_no_exact` | Granot `ref_no` === Mongo `FormLead.ref_no` |
| `mongo_id` | Granot `ref_no` resolved as Mongo `_id` |
| `fallback` | Phone/email/(name) after identity steps failed, source-gated |
| `none` | No usable match |

Extension today uses `mongo_id` / `phone_and_email` / `none`. Prefer renaming `phone_and_email` → `fallback` (or map in UI) for parity with server `fallback`.

---

## 9. Concrete implementation checklist (for the next agent)

### Shared rules first

1. Write/adjust tests that encode the ladder in §7 for both codebases (or shared fixtures).
2. Document that `source_company` is immutable under Granot sync; fallback must not select cross-source leads.
3. Keep duplicate quarantine as a universal exclude.

### Extension (`granot_sync_extensions_and_services`)

1. Parser: identity validity ≠ ObjectId-only.  
2. `preview.ts`:  
   - try search/exact by `ref_no` field (new API usage or dedicated endpoint if added);  
   - then ObjectId `GET`;  
   - then fallback with phone + email + name (+ optional `ref_no` in body);  
   - apply source-company hard gate before accepting a single fallback hit.  
3. Reuse server label→slug resolution or generate the map from the same source catalog.  
4. Update preview copy (“Found by ref_no” vs “Found by Mongo id” vs “Found by fallback”).  
5. Keep PATCH target = resolved `_id` only.

### Server (`granotHttpCollector`)

1. After exact `ref_no` miss, if ObjectId-shaped, attempt load by `_id` (non-duplicate).  
2. Change `selectGranotFormFallback` so source-company filter is a **hard filter**, not “prefer if any”.  
3. If product wants strictness on exact refs too, add optional source check → conflict.  
4. Preserve mutation parity with extension payloads.

### Out of band (posting), not blocking matching work

1. WordPress: `leadno` = provider `ref_no`; stop posting a fake `lid` field; optional `notes` = `lid`.  
2. Server `formLeadPayload`: completed — `leadno = ref_no`, optional `notes = lid`.  
3. Fix TBM empty Granot `ref_no` at the WordPress post so exact matching works without fallbacks.

---

## 10. Worked examples

### Top10 row (current production)

- Granot `ref_no` = `DT_czj2atkThs`  
- Mongo `FormLead.ref_no` = `DT_czj2atkThs`, `lid` = `LIDe9de1e77ee991`, `_id` = ObjectId  
- **Target:** step 1 `ref_no_exact`  
- **Extension today:** parser `invalid_ref_no` → phone/email fallback only

### TBM row with blank Granot `ref_no`

- Granot `ref_no` empty; Mongo has `tz…`  
- **Target:** skip 1–2 → gated fallback by phone/email/name + source `tbm_prime_leads`  
- Cross-source phone hit → `no_match`, not an update

### Mongo `_id` written as Granot `leadno`

- Granot `ref_no` = `6a72c49b1009d5e86400d193`  
- Mongo `_id` same; Mongo `ref_no` still provider id  
- **Target:** step 1 miss → step 2 `mongo_id`  
- **Server today:** would miss exact ref and fall through to phone/email  
- **Extension today:** already does step 2 first (accidentally correct for this regime only)

### Phone/email collide across sources

- Same phone on `top10_leads` and `tbm_prime_leads`; report source `Top10 Forms`  
- **Target fallback:** only `top10_leads` candidates eligible; if none, `no_match`  
- **Today:** soft prefer may still pick the other source when it is the sole top-score hit  
- **Invariant:** even today, `source_company` field itself is not overwritten — but quoted/cubic/receiver **can** be written to the wrong lead. Hard gate fixes that.

---

## 11. Key file index

### Server

- `src/services/granotHttpCollector/formWorkflow.ts` — match + patch  
- `src/services/granotHttpCollector/formWorkflow.test.ts` — current contract tests  
- `src/services/search/formLeadSearch.service.ts` — scored fallback search  
- `src/config/domain/sources.ts` — label ↔ `source_company`  
- `docs/granot-http-automation.md` — published identity rules  
- `src/services/crm/formLeadPayload.ts` — server→Granot post shape (related posting debt)

### Extension

- `src/parsers/granot/form-leads.ts` — ObjectId syncable gate  
- `src/workflows/form-leads/preview.ts` — resolve order  
- `src/workflows/form-leads/fallback-resolve.ts` — ambiguous fallback + local source map  
- `src/workflows/form-leads/payloads.ts` — syncable + PATCH payload  
- `src/api/formLeads.ts` — `getFormLeadById` / `searchFormLeads` (already has `ref_no?:` on body)

---

## 12. Bottom line for the implementing agent

1. **Primary identity** is Mongo `FormLead.ref_no` ↔ Granot list `ref_no` (from POST `leadno`).  
2. **Secondary identity** is Mongo `_id` when that string was written into Granot `ref_no`.  
3. **Fallbacks** are phone/email/name after those fail, with a **hard source-company gate**.  
4. **`source_company` is never overwritten**; the missing piece is refusing to **select** a cross-source fallback lead.  
5. Extension must stop requiring ObjectId for “valid ref”; server should add ObjectId resolution after field exact for dual-regime parity.  
6. Keep prior / fill-only location / empty-receiver rules; keep `lid` out of matching.
