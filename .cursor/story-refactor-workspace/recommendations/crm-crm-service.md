# Post The Already-Saved Form Lead To Granot, Never Throw, Then Hand Back Exactly What Was Sent — Skip And Payload Live Elsewhere — operational story

- Status: recommended
- Service: `crm` (Wave A, in-progress)
- Pass: 1 of this service — `crm.service.ts`
- Remaining in this service: `formLeadPayload.ts` (`crmConfig.ts` / `types.ts` / `index.ts` skipped on open)
- Target: `src/services/crm/crm.service.ts`
- Knowledge: none as a dedicated Service file. CRM Posting owner invariants live on [`docs/knowledge/services/form-lead.md`](../../../docs/knowledge/services/form-lead.md) (When `post_to_granot` and not Duplicate Lead → `submitFormLeadToCrm`; skip emits `crm.form_lead.submit.skipped`; payload `label` is Operations Registry `crm_label_snapshot`; payload `leadno` is persisted Tracking Reference). Software / wire notes: [`.cursor/rules/form-lead-granot-crm.mdc`](../../../.cursor/rules/form-lead-granot-crm.mdc) — this file encodes and sends; `formLeadPayload.ts` + `crm/types.ts` own wire names. Distinct from Form Lead Ingestion decide-and-finalize (skip vs post, Sheet Sync before this call, fake skip result): [recommendations/form-lead.md](form-lead.md). Distinct from later payload map / name split / `leadno` vs `lid` / Job Number must not replace `leadno`: later `formLeadPayload.ts`. Distinct from credentialed Hello Moving URL + log redact: sibling `crmConfig.ts` (skipped this open). Distinct from trusted Granot create (never CRM-posts): [recommendations/granot-lifecycle-create-lead-from-granot.md](granot-lifecycle-create-lead-from-granot.md). Distinct from webhook capture / drain: [recommendations/granot-lifecycle-capture.md](granot-lifecycle-capture.md) / [recommendations/granot-lifecycle-drainer.md](granot-lifecycle-drainer.md). Distinct from leftover CSV store / apply: [recommendations/granot-crm-csv-upload.md](granot-crm-csv-upload.md) / [recommendations/granot-crm-csv-sync.md](granot-crm-csv-sync.md). Distinct from HTTP automation apply: [recommendations/granot-lifecycle-automation-apply.md](granot-lifecycle-automation-apply.md). Distinct from root compatibility barrel `src/services/crm.service.ts` (Wave A leftover-root, later). This checkout’s `CONTEXT.md` mentions “Granot CRM posting” in the one-line intro and does not define CRM Posting / Tracking Reference / Granot Form Reference — do not invent a glossary copy. `docs/adr/` is absent here — knowledge still links ADR-0002 for “CRM Posting survives downstream failures”; do not invent an ADR copy, and do not silently reorder Sheet Sync vs this post so that link “wins.”
- Callers: **one runtime import site plus two barrels and one folder test.** After-commit: `leads/formLead.service.ts` `finalizeFormLeadCreateAfterCommit` calls `submitFormLeadToCrm(lead, { companyLabel: crmLabel })` only when `shouldPostToGranot` (`post_to_granot && !duplicate`). Skip builds a fake `CrmSubmitResult` (`ok: true`, `status: 0`, empty text, payload from `buildCrmFormLeadPayload`) and emits `crm.form_lead.submit.skipped` in that file — not here. Barrel: `crm/index.ts` re-exports `submitFormLeadToCrm`. Root facade: `src/services/crm.service.ts` re-exports the same name. Test: `crm.service.test.ts` (POST urlencoded body, HTTP 200, HTTP 400, network throw → status 0, `companyLabel` becomes Granot `label`). Not callers: `updateFormLead` / Form correction, `createLeadFromGranot`, webhook capture, CSV upload/sync, HTTP automation apply, `formLeadPayload.ts` / `crmConfig.ts` (this file imports them). `buildCrmFormLeadPayload` / `encodeCrmFormBody` / `summarizeCrmPayloadForLog` / `crmEndpointForLog` / `CRM_FORM_LEAD_ENDPOINT` are sibling exports this file uses; they are not this **interface**.
- Seams callers need: after-commit post (this file) vs decide-whether-to-post (Form Lead Ingestion); never-throw result that always carries the exact payload vs HTTP/network failure; started / completed / `http_error` / failed owner events vs skip event (skip is not this file); payload build (sibling) vs encode-and-send (this file); credentialed URL (sibling) vs redacted log line; this post vs trusted Granot create (never posts)
- Split later (only if the file outgrows one sitting): keep one file — this ~163-line module is one screenplay for “post the already-saved Form Lead to Granot, never throw, then hand back exactly what was sent.” If it later splits: `announceThatCrmPostingStarted.ts` / `sendTheUrlencodedFormLeadToTheGranotLeadGateway.ts` / `rememberTheGranotPostOutcomeWithoutThrowing.ts` — story files, never `create.ts` / `submit.ts` / `post.ts` / `update.ts` / `delete.ts`, and never merge payload map, endpoint config, skip, or Form Lead write into this file

`submitFormLeadToCrm` is executor mechanics. The owner question is: *The Form Lead is already in Mongo. Form Lead Ingestion already decided this one should post. Build the Granot wire body (sibling). Tell the owner we started, using a redacted gateway URL and a masked payload. POST that body as `application/x-www-form-urlencoded` to the Hello Moving lead gateway. If Granot answers 2xx, remember success and the response text. If Granot answers 4xx or 5xx, remember the HTTP error and still return the body we sent. If the network dies, remember status 0 and the error message, and still return the body we sent. This function never throws. This function does not decide skip. This function does not invent `leadno`. This function does not write a Lead.*

Payload map, credentialed URL, skip, Sheet Sync, trusted Granot create, and webhook capture already live in other **modules**. Do not pull those in.

## What this file actually does

Three beats of one “post the already-saved Form Lead to Granot” story, not “a CRM CRUD service,” and not skip / payload / create:

1. **Announce that CRM Posting started** — ask the sibling to build the Granot wire payload (`label` from caller `companyLabel` or the payload default). Fingerprint the payload for logs. Redact `API_ID` / `MOVERREF` on the gateway URL. Log `crm.form_lead.submit.started`. Write the matching operational event (`workflow: crm_submit`, `reportable: false`) with lead identity, Source Company, and `{ type: "form_lead", id }`. This beat does not fetch. This beat does not decide skip.

2. **Send the urlencoded Form Lead to the Granot lead gateway** — `POST` the sibling-encoded body to `CRM_FORM_LEAD_ENDPOINT` with `Content-Type: application/x-www-form-urlencoded`. Read `response.text()`. This beat does not remap fields. This beat does not swap `leadno` for Job Number or `lid`. This beat does not persist Mongo.

3. **Remember the Granot post outcome without throwing** — HTTP ok → log `completed`, info event, return `{ ok: true, status, responseText, payload }`. HTTP not ok → log `http_error` (raw `responseText` today), error event with `notificationCandidate: true` and `errorMessage: crm_http_<status>`, return `{ ok: false, status, responseText, payload }` (no `error` field). `fetch` throw → error log `failed`, error event with `notificationCandidate: true` and the cause message, return `{ ok: false, status: 0, responseText: "", payload, error: message }`. Every path returns the exact payload that was (or would have been) sent so Form Lead Ingestion can persist `crm_company_label` / `crm_response` / `crm_sync_status`. This function does not throw on Granot or network failure. This function does not emit `crm.form_lead.submit.skipped`.

There is no fourth mutate operation. Skip, payload field map, and endpoint construction are other files.

## Organization

Keep one file as the screenplay for “post the already-saved Form Lead to Granot, never throw, then hand back exactly what was sent.” Payload map, credential redact, Form Lead Ingestion decide/skip, and trusted Granot create already live in deeper **modules**. Do not pull those in. Do not invent a `CrmService` class. Do not invent a canonical-command `begin` / `complete` **seam** here — this is a best-effort after-commit side effect, not a Domain Command. Do not invent a skip **adapter** beside Form Lead Ingestion’s `shouldPostToGranot`. Do not invent a second payload **adapter** beside `buildCrmFormLeadPayload`. Do not invent a second fetch **adapter** that only this file would implement.

Do not move this into `formLead.service.ts` so “ingestion owns the post.” Do not move skip into this file so “one result owns skipped.” Do not move `buildCrmFormLeadPayload` here so “the poster owns the wire.” Do not split `create.ts` / `submit.ts` / `error.ts`. Do not silently reorder `finalizeSheetSync` before this call so ADR-0002 “wins.” Do not silently throw on HTTP 4xx so “fetch looks like the rest of the API.”

**External interface** stays small (this is the test surface). Announce, send, and remember-outcome are one story’s CRM Posting, not three CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `submitFormLeadToCrm` | `postTheSavedFormLeadToGranot` | Form Lead Ingestion after-commit when posting is due; folder test stubs `fetch` |

Keep the old name as a one-line alias until `formLead.service.ts`, `crm/index.ts`, and the root `crm.service.ts` facade migrate. Do not make callers learn `CRM_FORM_LEAD_ENDPOINT` / `recordOperationalEvent` / `encodeCrmFormBody` as the domain language.

**Principle: old exports stay as aliases.** `submitFormLeadToCrm` remains the imported name until Form Lead Ingestion points at the story name.

**No class for the workflow.** The type that *does* earn a name is the outcome bag Form Lead Ingestion already stores on the create response. It lives on sibling `types.ts` today — do not move the card here “so the poster owns its type”:

```ts
type GranotFormLeadPostOutcome = {
  ok: boolean
  status: number
  responseText: string
  payload: CrmFormLeadPayload
  error?: string
}
```

That is the handoff from “we sent (or tried to send) this exact body” to “Form Lead Ingestion can say `synced` / `failed` and persist the audit text.” Do **not** add `skipped: true` so “one result owns skip,” do **not** add `job_no` so “CRM can take Job Number,” and do **not** add `lid` onto `leadno` so “the gateway gets our Lead id.”

`CrmFormLeadPayload` / `CrmSubmitResult` stay on sibling `types.ts` until that module’s skip. `companyLabel` on the options bag is the Form Lead Ingestion **seam** for Operations Registry `crm_label_snapshot` — it is not a second public operation.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// crm.service.ts
// The Form Lead is already in Mongo.
// Form Lead Ingestion already decided this one should post.
// Build the Granot wire body (sibling).
// Tell the owner we started, redacted URL, masked payload.
// POST urlencoded to the Hello Moving lead gateway.
// 2xx → remember success and the response text.
// HTTP error → remember the status and still return the body we sent.
// Network death → status 0, error message, still the body we sent.
// This function never throws.
// This function does not decide skip.
// This function does not invent leadno.
// This function does not write a Lead.

// ── 1. Post the already-saved Form Lead to Granot ─────────

export async function postTheSavedFormLeadToGranot(lead, options)
export const submitFormLeadToCrm = postTheSavedFormLeadToGranot

async function announceThatCrmPostingStarted(lead, payload, companyLabel)
async function sendTheUrlencodedFormLeadToTheGranotLeadGateway(payload)
async function rememberThatGranotAcceptedTheFormLead(lead, payload, status, responseText, companyLabel)
async function rememberThatGranotReturnedAnHttpError(lead, payload, status, responseText, companyLabel)
async function rememberThatTheGranotGatewayCouldNotBeReached(lead, payload, cause, companyLabel)

function leadIdentityForCrmEvents(lead)
function crmEntityForThisFormLead(lead)
```

Read the primary path out loud: *The Form Lead is already saved. Build the Granot body. Announce that posting started, with a redacted gateway and a masked payload. POST the urlencoded body. If Granot accepts, remember success. If Granot answers with an HTTP error, remember that error and still hand back the body we sent. If the network dies, remember status 0 and still hand back the body we sent. Never throw. Never decide skip. Never invent `leadno`.*

That is the operation. `submitFormLeadToCrm` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Four copy-paste operational-event envelopes.** Started / completed / `http_error` / failed repeat `category: "crm"`, `workflow: "crm_submit"`, the same lead identity, Source Company, and `{ type: "form_lead", id }`. The decision is the beat (started vs accepted vs HTTP error vs unreachable). One shared envelope, four story names. Do not extract a generic `emitCrmEvent(key)` helper that hides which beat is owner-visible.

2. **“Never throws” is the documented contract and a partial lie.** Granot and `fetch` failures are caught. `recordOperationalEvent` and the logger are `await`ed on the success path *and* inside `catch`. If observability throws after a good POST, the caller never receives the payload it needs to persist `crm_response`. Name `rememberThatGranotAcceptedTheFormLead` so that leak is visible. Do not silently wrap observability so “the comment becomes true” in this rename.

3. **Skip fabricates `ok: true`, `status: 0` in Form Lead Ingestion.** That result looks like a successful post with no HTTP. Keep skip there. Do not add a `skipped` branch to this file so “one function owns every `crm_sync_status`.” Do not change the fake skip result here — that **seam** is [recommendations/form-lead.md](form-lead.md).

4. **`responseText` is logged raw on HTTP error.** The request payload is summarized and fingerprinted. Granot’s body is not. Name the remember-HTTP-error beat so a later pass can mask the response without silently changing today’s audit string (`crm_response` still needs the raw text Form Lead Ingestion stores). Do not redact `responseText` on the returned outcome in this rename.

5. **`companyLabel` vs `payload.label` is a dual source.** Events use `options.companyLabel ?? payload.label`. The sibling already defaulted a blank label to `CRM_FORM_LEAD_LABEL`. Prefer the payload label after build so the event and the body cannot disagree. Do not read `CRM_FORM_LEAD_LABEL` in this file so “the poster owns the default.”

6. **Do not silently fix the Sheet Sync → CRM order.** Knowledge already flags `finalizeSheetSync` before this call as reversed from ADR-0002. This file is only the post. Reorder only as a separate, tested change on Form Lead Ingestion. `docs/adr/` is absent here — do not invent the ADR so the knowledge link has a local file.

7. **Leave sibling modules alone.** `buildCrmFormLeadPayload`, `encodeCrmFormBody`, `summarizeCrmPayloadForLog`, `crmEndpointForLog`, and `CRM_FORM_LEAD_ENDPOINT` are already the right **depth**. This file orchestrates them. Job Number must not become `leadno` — that invariant is the payload file’s next pass, not a silent map here.

8. **`fetch` is global, not an injected adapter.** Tests stub `globalThis.fetch`. That is enough. Do not invent a `deps.send` **seam** that has only one live adapter.

## Testing

The **interface** is the test surface: `postTheSavedFormLeadToGranot` (today `submitFormLeadToCrm`).

Today’s `crm.service.test.ts` already names the send and the three outcomes: urlencoded POST to the gateway, HTTP 200 returns ok plus payload, HTTP 400 returns ok false plus raw body plus payload, network throw returns status 0 plus `error` plus payload, `companyLabel` becomes Granot `label`. Keep those as the operation tests. They stub `fetch` and disable observability writes.

Add tests that name the remaining owner-visible beats. Do not add a test per helper:

**Post**
- A saved Form Lead is POSTed once, urlencoded, to the Hello Moving gateway — not to a second URL this file invents.
- HTTP 2xx → `ok: true`, status, `responseText`, payload, no `error`.
- HTTP 4xx/5xx → `ok: false`, status, `responseText`, payload, no throw, no `error` field (today’s shape).
- `fetch` throw → `ok: false`, `status: 0`, empty `responseText`, `error` message, payload still present, no throw.
- Caller `companyLabel` is the Granot `label` on the returned payload and on the body.
- The returned payload is the sibling-built body (Tracking Reference as `leadno`, `lid` in `notes`) — this file does not remap.

**Not this interface**
- Skip (`post_to_granot` false or Duplicate Lead) stays on Form Lead Ingestion. Do not add a skip test here so “the poster owns `crm.form_lead.submit.skipped`.”
- Payload field map / name split / `not provided` → empty `leadno` / Job Number must not replace `leadno` stay on later `formLeadPayload.ts`.
- Credential redact of `API_ID` / `MOVERREF` stays on skipped `crmConfig.ts` (`crmEndpointForLog`).
- Sheet Sync before this call stays on Form Lead Ingestion. Do not assert order from this folder.

Do **not** add a test per helper (`announceThatCrmPostingStarted`, `leadIdentityForCrmEvents`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

There is no `begin` / `complete` export. Canonical commands do not post to Granot from this file.

## What I would not do

- A `CrmService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `fetch` or `recordOperationalEvent`.
- Moving this into a CRUD folder (`create.ts` / `submit.ts` / `delete.ts`) for cleanliness.
- Breaking the after-commit **seam**. CRM Posting must not sit inside the Mongo Form Lead write.
- Treating trusted Granot `createLeadFromGranot`, webhook capture, CSV apply, or HTTP automation apply as this story.
- Inventing a skip **seam** that has only one **adapter** (Form Lead Ingestion already owns skip).
- Inventing a `deps.fetch` **seam** that has only one live adapter.
- Silently “fixing” the known Sheet Sync → CRM order gap while recommending a rename.
- Jumping to `leadMessaging` while `formLeadPayload.ts` is unchecked.
- Writing a whole-folder recommendation for `crm`.
- Teaching this file to write `leadno` from Job Number, `lid`, or Mongo `_id`.
- Throwing on HTTP 4xx so “errors look like the rest of v1.”
- Moving `buildCrmFormLeadPayload` or `CRM_FORM_LEAD_ENDPOINT` into this file so “one CRM module.”
