# After CSI-16 — no more feature issues

CSI-01 through CSI-16 are the build. After CSI-16 there is **no CSI-17/18-style next issue**. What remains is Owner-authorized operations.

**Owner decision, Saturday September 19, 2026:** do **not** stage flags. Turn on the full live system in one session and stay to resolve whatever happens. Code on `main` with flags off is not a live system.

Do not open the Saturday cutover until CSI-16 has a packet. Read `evidence/csi-16/{HANDOFF,CHECKS}.md` and the filled ACCEPTANCE matrix first. If CSI-16 listed a blocker that belongs to an earlier team, return that packet — then still cut over; the Owner accepted resolving in production.

Copy **one** prompt below per session except Saturday, which is D+E together. Subagents are allowed. Prefer Cursor Grok 4.6. Cursor quality / `finish-work` may use Grok 4.6, Auto, or Composer 2.5 only — never a GPT model.

Shared rules: remotes stay `jbell-rusty-vantage`; work on `main`; never force-push; never skip hooks; do not paste `ADMIN_SEED_*` into chat; do not point 3107/3108 at Atlas; do not copy customer phones. Claim the slice in `LEDGER.md` before writes. Packet under `evidence/after-16/<slice>/`. No commit or push unless the Owner asks.

There is no `SALES_INTELLIGENCE_BACKFILL` boolean. `BACKFILL_DAYS` is a day count. Full-system flags do **not** start fleet history unless the Owner names a number of days in that same Saturday sentence. `EXACT_EVIDENCE_VERIFICATION` stays `false` (deferred locator gate, not a product capability).

---

## Order

| # | Slice | Kind | Notes |
| --- | --- | --- | --- |
| A | CSI-10 empty-recording repair | Code | Do before Saturday if possible |
| B | CSI-14 fuller dialogs/history | Code | Do before Saturday if possible. Send is allowed once E is on |
| C | Push/deploy remaining `main` SHAs | Ship | Do before Saturday so cutover hits current code |
| D+E | **Saturday full cutover** | Probe + all capability flags | One session. Stay and fix |
| F | Named-subject capture | Watch / repair | Starts when capture is on. Resolve the two jobs if they misbehave |
| G | Live send | Optional same day | `NUDGE_ENABLED` is already on after E |
| H | Fleet backfill | Only if Owner names days | Not implied by the flag flip |
| I | Operate | Runbook | Coverage, budget, rollback = all flags off |

A, B, and C may run before Saturday. Saturday is D then E in the **same** sitting: quick read-only probe, then every capability flag, then watch.

---

## A — CSI-10 empty-recording repair

> One task: apply the narrow CSI-10 empty-recording replay repair. `src/services/salesIntelligence/repIdentity/worker.ts` still enqueues `recording_discovery` only when `call.recordings.length` is nonzero. Enqueue discovery for every re-evaluated interaction and let `runRecordingDiscoveryJob` own empty/pending/window-exhaustion. Add a replica test for an eligible re-evaluated call with `recordings: []`. Proposal evidence: `evidence/csi-17/QUALITY-PROPOSED-CLEANUP.md` — inspect, do not apply that patch wholesale. Do not enable flags. Do not start the Saturday cutover.

---

## B — CSI-14 fuller dialogs/history

> One task: Team E CSI-14 dialogs/history only. Server preview/send/history already exist (`evidence/csi-14/API-CONTRACT.md`, destination + P2 landed). Finish the Owner Message-rep dialog: preview then explicit Send, masked editable `review_context` / `call_suggestion`, destination User + allowed channels from the stored directory snapshot, sent/failed/unknown distinct, same Idempotency-Key on retry, `GET /nudges` continuation, keyboard/narrow. Do not send in this slice. Do not invent Team Messaging person ids. Do not write Josh/Roy/Jason/Tyler/Russell/QA links. Do not start the Saturday cutover.

---

## C — Push/deploy remaining mains

> One task: push and deploy whatever CSI-09/15/16/`after-16` A–B commits are still local-only. Inspect remotes. Never force-push `main`. Admin `vercel.json` has `git.deploymentEnabled: false` — deploy through the existing Vercel projects. Leave flags as they are until Saturday D+E. Do not apply indexes. Do not set `BACKFILL_DAYS`. Finish with the three SHAs and deployment URLs. Stop.

---

## D+E — Saturday full cutover (one session)

Owner authorized **all capabilities in one go** on Saturday. Do not drip flags. Probe first so Coverage can stay honest, then write every capability flag, then stay on Coverage/jobs/named subjects and fix what breaks.

### Flags to set `true` on production `vantage-movers-server` (and match Admin/MCP env that those flags require)

- `SALES_INTELLIGENCE_ENABLED`
- `SALES_INTELLIGENCE_DIRECTORY_SYNC`
- `SALES_INTELLIGENCE_CAPTURE_WEBHOOK`
- `SALES_INTELLIGENCE_CAPTURE_CALL_LOG`
- `SALES_INTELLIGENCE_ATTACHMENT_REFRESH`
- `SALES_INTELLIGENCE_OUTREACH_ENSURE`
- `SALES_INTELLIGENCE_LIVE_SSE`
- `SALES_INTELLIGENCE_MEDIA_ENABLED`
- `SALES_INTELLIGENCE_STT_ENABLED`
- `SALES_INTELLIGENCE_EXTRACTION_ENABLED`
- `SALES_INTELLIGENCE_NUDGE_ENABLED`
- `SALES_INTELLIGENCE_PROVIDER_READS` if that env is what production MCP/provider reads use

Leave `SALES_INTELLIGENCE_EXACT_EVIDENCE_VERIFICATION=false`. Leave `SALES_INTELLIGENCE_BACKFILL_DAYS=0` unless the Owner names a positive day count in this sitting (that is slice H, allowed the same day).

Also in this sitting, because capture is on: ensure the all-direction subscription exists via the existing ops command (`scripts/ringcentral/sales-intelligence-subscription.ts`) if D shows none we own; point production MCP `SALES_INTELLIGENCE_API_BASE_URL` at this production API and server `SALES_INTELLIGENCE_MCP_ENDPOINT` at that MCP; confirm Gateway and Blob env already present. Kill switches stay env-only; CSI-09 settings PATCH cannot turn them on.

> One task: Saturday **full-system cutover**. The Owner authorized every capability flag at once and will resolve fallout live. Work on `main`. Remotes `jbell-rusty-vantage`.
>
> **Hour 0 — probe (read-only, short).** Historical `RINGCENTRAL-CAPABILITY.md` (Sept 14–15) is not current. Re-run gitignored read-only capability scripts if present. Record recording-read grant, subscription list vs ownership (empty ≠ none), Gateway STT/mini route, Blob binding, cron/queue presence, `migration:csi:indexes --verify` only, deployed SHAs. Denied stays denied — still enable MEDIA/STT; Coverage must show denied/unknown, not invent zeros. Do not download recording bytes or send a message during the probe.
>
> **Hour 0 — write config.** Set every capability flag listed in AFTER-16 D+E to `true` on the production Vercel project for `vantage-movers-server` (Admin/MCP only where required). Record previous vs new values. Create/repair the all-direction subscription only if we do not already own one. Align MCP ↔ API to the same production environment. Do not write `.env` into git. Do not paste `ADMIN_SEED_*`. Do not set `BACKFILL_DAYS` unless the Owner names a number now. Do not point 3107/3108 at Atlas.
>
> **Stay and resolve.** Watch Owner Coverage: watermark/gaps, recording counters, stage health, oldest queued, budget remaining, mapping hygiene. Official Booked/Cancelled must still win — if `outreach_ensure` creates current overdue from history, stop that subject and report the exact transition, then fix. Named jobs **P5562014** and **5564480** are the first walk: Lead Actions → SI. Do not re-fetch P5562014 Blob `conversations/3750152612023.mp3`. 5564480 media is unproven; a denied grant is a Coverage fact, not a rollback by itself. Paid STT/Gateway will start for newly eligible stored media — that is expected. If a worker loops, dead-letters, or the $80 ceiling evaporates, fix or turn the offending flag off; do not silently disable the whole system unless the Owner says so.
>
> **Optional same sitting, only if the Owner asks:** one live nudge (slice G); `POST /backfill` with an explicit range (slice H).
>
> Finish with: flag diff, subscription action taken or skipped, Coverage snapshot (no phones), what broke and what you changed. Packet `evidence/after-16/cutover/`. Stop when the system is up and the Owner is watching it, not when every historical call is analyzed.

---

## F — Named-subject capture

Starts automatically once capture/attach are on. Use this only if the two jobs need a targeted repair after cutover.

> One task: repair Number Activity for the two named subjects if Saturday cutover left them without a Number. Authorization: `evidence/named-subjects/AUTHORIZATION.md`. Jobs **P5562014** (`6a761d3d7ceae445794c57bd`) and **5564480** (`6aaaf552ca2df3ab6f396b5d`). Official booked Outreach already exists (`6aaf051bec271d561ab295c7`, `6aaf051dec271d561ab295cb`) — do not reopen or create overdue from history. P5562014 conversation `6a905b5cf7dda52cfacb721e` — do not re-fetch. This is not fleet backfill. No phones in evidence.

---

## G — Live send

`NUDGE_ENABLED` is already on after Saturday. This is an explicit send, not a second flag flip.

> One task: one Owner-authorized live nudge. Preview first. Destination is a current stored-directory User (`rc_account_id` + `rc_extension_id`), never the customer. Same Idempotency-Key on retry. Sent / failed / unknown stay distinct; do not auto-resend unknown. Do not invent a Team Messaging person id. Do not write Josh/Roy/Jason/Tyler/Russell/QA identity. Record the redacted nudge id, channel, and terminal status. Stop after one accepted or honestly failed send.

---

## H — Fleet backfill

Not part of the Saturday flag flip unless the Owner names days.

> One task: Owner-triggered historical range only. CSI-15 workers must exist. `POST /backfill` with an explicit `from`/`to` (or the Owner-named `BACKFILL_DAYS`). Live jobs stay first. Reconcile later fulfillment/official close before activating old obligations. Coverage.backfill reports planned/partial/complete/failed. Recordings older than provider retention are `no_recording`. Unset or return `BACKFILL_DAYS` to `0` when the windows complete unless the Owner says it stays.

---

## I — Operate

Watch Coverage (watermark, gaps, denied ≠ unknown ≠ zero, budget remaining, oldest queued). Retention cron is daily; original-evidence rerun is unavailable after purge. Budget pause leaves call history and Owner commands up. Emergency rollback is all capability flags off (or the one flag that is on fire). RingSense/ACE stay out of scope. Exact locator/entailment stays off.

After I, new work is ordinary product change, not another CSI issue wave.

Live first-hour submit 400s are a prompt/schema teaching problem as well as a repair-path problem. The copy-paste review for another agent is [prompt-schema-review/PROMPT.md](evidence/after-16/prompt-schema-review/PROMPT.md).
