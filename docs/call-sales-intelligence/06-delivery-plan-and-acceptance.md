# 06 — Delivery plan, issue pack, acceptance, and open decisions

Status: implementation-ready. Pack index: [`README.md`](README.md).

## 1. Branches and flags

| Repo | Branch | Base |
| --- | --- | --- |
| `vantage-main-server` | `feature/call-sales-intelligence` | `main` |
| `vantage-admin` | `feature/sales-intelligence-dashboard` | `main` |

Every server behavior ships behind the flags in 03 §1, all default `false`. Production enable order: reads (`ENABLED`) → capture (`CAPTURE_CALL_LOG`, then `CAPTURE_WEBHOOK`) → `DIRECTORY_SYNC` → `ATTACHMENT_REFRESH` → `OUTREACH_ENSURE` → `LIVE_SSE` → media/STT/extract → `NUDGE_ENABLED`. Rollback is the reverse; data stays.

Preview deployments: Admin Preview needs `VANTAGE_API_PROTECTION_BYPASS` for the server Preview (existing rule). RingCentral collection mode stays `test` on Preview; new collections use the `TEST_MODE` DB boundary.

## 2. Issue pack

Each issue lists scope, files, and acceptance. Order is dependency order; CSI-01..04 are the foundation, CSI-05..09 the first Owner release, CSI-10..16 the intelligence and nudge layer.

### CSI-01 — Config, policy, models, indexes (server)

Scope: `src/config/domain/salesIntelligence.ts`; all models in 02; additive `LeadConversation` fields; `scripts/migrations/sales-intelligence-indexes.ts` (`--report|--apply --confirm-production=<db>|--verify`); enum additions in `conversations.ts`; OKF card `docs/knowledge/services/call-sales-intelligence.md` (pointer); `docs/index.md` row.
Acceptance: `pnpm typecheck`, `pnpm test`; migration report on `testvantagemovers` lists every index; verify passes after apply; unique fences (`contact_number_e164_unique`, `call_interaction_session_unique`, `nla_pair_unique`, `outreach_subject_unique`, `ril_extension_current_unique`, `nudge_idempotency_unique`, `sales_intelligence_sync_state_key_unique`) exist; existing `lead_conversations` tests unchanged; runtime fails closed with a bounded error when the sync-state key index is absent.

### CSI-02 — Number Activity capture: projection + Call Log reconcile (server)

Scope: `numberActivity/phone.ts`, `directory.ts`, `interactionProjection.ts`, `contactNumbers.ts`, `contactType.ts` (rules only), `reconcileCallLog.ts`, cron route + `vercel.json` entry, `sales-intelligence-cron.routes.ts`, directory sync cron.
Acceptance (fixture replay from the Sept 4–11 `calls.json` shape): 3,919 external sessions produce 3,919 interactions and 1,336 Contact Numbers; the 19 internal sessions have `contact_number_id: null`; queue fan-out legs never create extra interactions; replaying the same pages twice changes nothing (`projection_revision` stable); a record with newer `lastModifiedTime` and a new recording adds the pointer without un-terminating; 429 ends the run with cursor untouched and a `gaps[]` entry; cursor advances only on full success; the qualified-call sync state document is byte-identical before/after; lease contention returns `lease_held`; no phone, name, or provider body appears in logs/events/metrics.

### CSI-03 — Webhook fan-out, all-direction subscription mode (server)

Scope: `numberActivity/observeWebhookEvents.ts`; edit `ringcentral-webhook.routes.ts` (fire-and-forget after capture, flag-guarded); `webhook-subscriptions.ts` mode `all`; `ringcentral-webhook-create.ts --mode all`.
Acceptance: replayed webhook fixtures (ringing → answered → disconnected; out-of-order; duplicate uuid; late terminal; transfer; monitoring) converge to the same interaction as the Call Log projection; a party event with stale `sequence` is ignored; the existing inbound qualification tests pass unchanged; with the flag off the route behavior is byte-identical.

### CSI-04 — Timeline, search, rollups, rebuild (server)

Scope: `numberActivity/timeline.ts`, `search.ts`, `rebuild.ts`; admin routes `overview` (counts only for numbers), `numbers`, `numbers/:id`, `numbers/:id/timeline`, `numbers/:id/rebuild`, `numbers/:id/classify`; `coverage.ts` (watermark + capabilities from the last capability probe stored by the directory sync); DTOs.
Acceptance: suffix search `0143` finds `+17573180143`; name search finds by attached-Lead name (after CSI-05) and provider caller name; timeline merges interactions and Lead Messages by digits in order; `company` numbers hidden unless requested; every response has `as_of` + `coverage`; Owner gate on every route; feature-off 404.

### CSI-05 — Attachment suggestions and Owner attach/reject (server)

Scope: `salesIntelligence/attachment/*`, routes `attachments*`; lead watermark cursor in sync state.
Acceptance (fixtures): exact `ringcentral.telephony_session_id` → `attached/exact`; single Form Lead within −36 h/+14 d → `candidate/likely`; two overlapping → both `ambiguous`; non-overlapping months apart → two `candidate`; Owner attach resolves siblings; Owner reject never re-suggested; edges never write Leads; Form Fill / Duplicate flags untouched; the 53 exact identities from the validation set reproduce as `attached`.

### CSI-06 — Outreach ensure, transitions, derive, commands, follow-ups (server)

Scope: `salesIntelligence/outreach/*`, `followups/*`, `staffing.ts`, `policy.ts`, routes `attention`, `outreach/*`, `followups/*`, `numbers/:id/open-review`; overview counts.
Acceptance: eligible Form Lead → `unworked` with `first_action_due_at` in staffed time (DST and Sunday cases tested); ineligible → `closed` with mirrored reason; attributable outbound → `open`; voicemail keeps `unworked`/`open` and never sets `last_meaningful_contact_at`; inbound while `waiting_on_customer` → `open` with `no_next_action`; Booking on the Lead → `closed:booked`; ambiguity → `identity_review` and back; illegal Owner transitions 422; `expected_revision` mismatch 409 with refreshed data; attention bands order exactly per 01 §8 with a seeded fixture of 20 records; suppressed numbers absent from attention; cooldown demotes within band; derive is pure and versioned.

### CSI-07 — Live SSE (server) + live BFF (admin)

Scope: `salesIntelligence/live.ts`, route `live`; `app/api/sales-intelligence-live/route.ts`.
Acceptance: watermark poll emits `interaction` / `outreach` / `coverage` / `heartbeat`; `Last-Event-ID` resumes without duplicates; connection closes at max age; Admin 403 at the BFF.

### CSI-08 — Admin: shell, Attention, Numbers, panels, command dialogs

Scope: everything in 05 §10 except Reps, Coverage, findings, and Message rep; authorization; nav; copy file; query keys; API client; board helpers.
Acceptance: Owner sees the nav item, Admin does not and gets 403 on proxy paths; `?record=` / `?number=` survive filter writes; every state and reason code has copy (iteration test); command dialogs send `Idempotency-Key` and `expected_revision`, keep unsent values on 409; live events merge in place; `pnpm lint`, `pnpm typecheck`, tests; browser walk: search → number → timeline → open record → set next step → close → reopen.

### CSI-09 — Admin: Coverage view + Lead detail chip + Overview tile (admin)

Scope: `coverage-view.tsx`; "Open in Sales Intelligence" chip on Form/Call Lead detail; optional Overview "Needs a call" tile.
Acceptance: denied capability renders words, never zero; backfill button plans once and shows `BACKFILL_ACTIVE` copy on repeat; chip hidden when no record.

**First Owner release = CSI-01 … CSI-09** with capture, attachment, outreach, and reads enabled. No audio, no AI, no nudges.

### CSI-10 — Rep Identity Links (server + admin)

Scope: `repIdentity/*`, routes `reps*`; Reps view.
Acceptance: proposals only on exact normalized name/alias equality; two same-first-name Agents never auto-proposed; one current link per extension enforced (partial unique); activity rollups only on reviewed links; retire closes `effective_to`.

### CSI-11 — Conversation discovery, relevance, media fetch (server)

Scope: `conversations/discover.ts`, `media.ts` streaming upload, cron routes, `ringcentral/messaging/recordings.ts` (Range + Retry-After), `aiBudget.ts` (reserve/reconcile scaffold).
Acceptance: discovered rows created only for terminal interactions with a recording; relevance bands per 03 §6.1 with the 5 % sample deterministic by id hash; 404 → `no_recording`; 403 → `unavailable:permission_denied` + capability `denied`; 429 → `unavailable:throttled` with `unavailable_until`; > max bytes → `unavailable:media_too_large`; `contentUri` never persisted (grep test); Blob object private; digest stored; bounded per run.

### CSI-12 — Transcription, redaction extension, contact type by model (server)

Scope: `conversations/transcribe.ts`, `redaction.ts` spoken-digit extension, `contactType.ts` model hook, budget reserve/reconcile, cron.
Acceptance: raw STT never persisted (test asserts every persisted sentence passed the redactor); spoken 16-digit runs and CVV phrases redacted in fixtures; segments have ids 1..n; voicemail detected on the Sept 11 voicemail fixture; budget exhaustion → `unavailable:budget_exhausted` and Coverage `ai_paused`; contact type propagates to the interaction and triggers outreach transitions.

### CSI-13 — Extraction, entailment, findings, number summary, Owner review (server + admin)

Scope: `conversations/extract.ts`, `numberSummary.ts`, `findings/commands.ts`, routes `conversations/:id/findings`, `findings/:id/*`, `conversations/:id/process`, existing conversations detail additive fields; Admin findings section, Confirm/Not right, transcript viewer with sentence ids, Conversations tab on both panels.
Acceptance: schema-invalid outputs are rejected and retried once; findings with missing citations dismissed as `citation_missing`; entailment `fail` dismissed; relative dates resolved in America/New_York (fixtures: "tomorrow after 3", "next Tuesday", ambiguous "the 5th" → unresolved); accept `promised_callback` creates exactly one follow-up and sets `next_action`; accept `contact_restriction` requires a choice and closes `suppressed`; `booking_claim` never writes a Booking (grep + test); number summary recomputed only when the evidence digest changes; the Sept 11 long-sample "early December" case yields `entailment_check: unsure|fail`, never an accepted due date; 50–100 call evaluation sheet produced (precision/recall by kind) before enabling in production.

### CSI-14 — Owner Rep Nudge (server + admin)

Scope: `nudges/*`, `ringcentral/messaging/teamMessaging.ts`, `sms.ts`, `pager.ts`, routes `nudges*`, repair cron; Message rep dialog.
Acceptance: preview never sends (adapter spy); every precondition has a blocker code and copy; destination equal to any customer number → 422 + error event (fixtures for E.164 and 10-digit forms); idempotent replay returns the same nudge; per-rep hourly limit; Team Messaging chat creation reuses the existing Direct; fallback to pager only; `pending` repair resolves to `sent`/`failed`; body never contains more than the last 4 digits of the customer number; proxy audit row exists for the POST.
Proof step before enabling in production: one Owner-chosen rep, one Direct chat, copy approved in chat, one live POST, screenshot in the Owner's RingCentral app.

### CSI-15 — Backfill and retention (server + admin)

Scope: `backfill.ts`, windows, cron step; retention cron; Coverage "Load older history".
Acceptance: windows complete only after the last page; partial windows resume at the checkpoint; `known_complete_through` never moves backward; audio purge sets `purged_at` and the audio-url route returns 409; transcript purge keeps findings' claims.

### CSI-16 — Certification walk and knowledge restamp

Scope: end-to-end browser walk on Preview with test-mode RingCentral collections; restamp OKF card; update `.cursor/rules/project-organization.mdc` in both repos with the new folders and routes; update `CONTEXT.md` with the agreed glossary terms.
Acceptance: walk script passes (search → attention → which lead → next step → message rep preview → coverage); rules files describe reality; no `TODO` in Owner copy.

## 3. Test matrix (server)

| Area | Tests |
| --- | --- |
| Projection | queue fan-out, duplicate legs, transfer across sessions, monitoring, answered voicemail, unknown caller, company-number calls, delayed events, duplicate delivery, missing terminal event, internal-only session, withheld/malformed numbers |
| Reconcile | lease claim/renew/loss, cursor immobility on failure, 12-h floor, oldest-first, 429 gap, page checkpoint, idempotent rescan, telemetry privacy |
| Attachment | exact id, single candidate, overlapping ambiguity, non-overlapping candidates, Owner attach/reject, Form Fill untouched, cross-source same phone, alternate Granot contact, later snapshot does not rewrite `observed_at` |
| Outreach | every transition row in 01 §5.3, staffed clock (DST, weekend), derive bands, cooldown, suppression, revision fencing, illegal transitions, closed reasons mirror official records |
| Conversations | state machine including `unavailable` reasons, budget reserve/reconcile, redaction extension, raw text never persisted, `contentUri` never persisted |
| Findings | schema validation, citation existence, entailment gating, date resolution, accept effects (exactly one), dismiss, supersede, number summary digest |
| Nudge | preconditions, customer-destination guard, idempotency, rate limit, fallback, repair |
| Routes | Owner gate, feature-off, Zod 400, 409 shape, 500 never echoes message, cron auth/skip |
| Import boundaries | grep test forbidding the ingest/vetting/convergence imports under the two new service folders |

Replica-gated tests (`*.replica.test.ts`) for lease races, concurrent reconcile, and accept-vs-transition races.

## 4. Test matrix (admin)

URL state (filter vs panel keys), copy completeness over closed sets, board merge on live events, legal-transition table, authorization page + proxy, API client idempotency reuse, dialog 409 preservation, coverage rendering of `denied`/`unknown`.

## 5. Launch targets (to load-test, not guarantees)

p95 webhook-to-visible interaction < 60 s; Call Log reconcile lag < 15 min; attention query < 800 ms at 10k open records; command < 2 s; no lost Owner command on worker failure; SSE reconnect < 5 s.

## 6. Security and privacy checklist

- Owner-only everywhere (page, proxy, server). Admin gets 403; Sales/Customer Service extension roles have no route into this system.
- Full customer numbers appear only in Owner DTOs; nudge bodies last-4 only; logs/events/metrics carry none.
- Raw STT transient; redaction before persist; audio private Blob; signed URL 5 min, audited.
- Provider tokens and `contentUri` never persisted; `.env` only.
- Transcript content is untrusted model input; no tools; structured output only; every finding cited and validated.
- Retention cron with tombstones; deletion propagates.

## 7. Open decisions and the defaults this pack builds with

| # | Decision | Default in this pack | Who decides |
| --- | --- | --- | --- |
| D1 | Which of the 24 RingCentral users are sales reps vs service/managers/dialers/shared | Everything starts `proposed`; Owner reviews in Reps; only `sales_rep` links get nudges | Owner |
| D2 | Nudge channels | Team Messaging on; SMS-to-rep and pager available but off (`NUDGE_CHANNELS=team_messaging`) | Owner |
| D3 | Offers vs direct assignment vs both | Out of first release; `responsible_agent_id` is Owner-set only; `sales_assignment_id` reserved | Owner, later |
| D4 | Staffed hours, first-action due | Mon–Sat 08:00–20:00 America/New_York; 30 staffed minutes; both env-configurable and stamped as `policy_version` | Owner |
| D5 | Recording/transcript visibility and retention; company-wide recording grant | Owner-only; 90-day audio, 365-day transcript, 730-day activity; capability shows `denied` until granted | Owner + RingCentral admin |
| D6 | ACE license vs Gateway STT; extraction model | Gateway; Whisper STT; Claude Sonnet 5 extraction with Luna allowlisted; choose after the CSI-13 evaluation | Owner + engineering |
| D7 | Allocation objective | Not built; Attention order is urgency only | Owner, later |
| D8 | Production webhook subscription ownership (0 visible on Sept 14) | Create an `all` subscription from this app; keep the inbound one until the qualified path is proven equivalent | Engineering |
| D9 | Auto Number Review for missed inbound on unmapped DIDs | No; hygiene count only | Owner |
| D10 | Whether Daily Operations shows an actionable count | Optional single tile on Overview only | Owner |

None of these blocks CSI-01 … CSI-09.

## 8. Definition of done for the pack

- All CSI issues merged behind flags; `pnpm test`, `pnpm typecheck`, `pnpm lint` green in both repos.
- Index migrations applied and verified on `testvantagemovers`; production apply is a separate, confirmed step.
- OKF card, `docs/index.md`, both `project-organization.mdc` files, and `CONTEXT.md` glossary updated.
- Owner walk on Preview signed off; first nudge proof executed and recorded.
