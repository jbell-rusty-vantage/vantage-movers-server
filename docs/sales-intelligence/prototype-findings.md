# RingCentral + Vantage prototype — findings and runbook

Investigation: September 11, 2026. See the [recommendation specification](recommendation-specification.md) and [AI experiment](ai-experiment.md).

## Open the result

The interactive artifact is `scripts/dev_ops/ringcentral/output/sales-intelligence/preview.html`. It is self-contained: open it directly in a browser without credentials. During this investigation it is also served at `http://127.0.0.1:43187/` while the preview process remains running.

Views cover follow-up review, searchable number timelines, rep evidence, and capability limits. Customer numbers are masked, but this is internal business material. Hashes are navigation aids, not anonymization guarantees. Source probes and data live under the existing gitignored `scripts/dev_ops/` tree; the documentation is tracked normally. No production implementation was deployed.

## Artifacts

All filenames below are relative to `scripts/dev_ops/ringcentral/output/sales-intelligence/`.

| File | Contents |
| --- | --- |
| `evidence.json` | Fixed window, HTTP results, completeness, counts, scopes, recording probes. |
| `calls.json` | Private Detailed all-direction Call Log; 3,938 records across 16 pages. |
| `form_leads.json`, `call_leads.json` | Projected contact provenance, lifecycle pointers, receiver, source, provider identity. |
| `agents.json`, `extension_users.json` | Identity candidates; no Extension User passwords requested. |
| `extensions.json`, `numbers.json`, `queues.json`, `queue-*.json` | Full directory; membership sampled for the first ten queues. |
| `booked_leads.json` | Official Booking dates, allocations, selected attachment/context fields. |
| `subscriptions.json` | Visible status/filter/expiry metadata; delivery addresses omitted. |
| `analysis.json` | Derived counts, number timelines, gap candidates, unverified rep joins. |
| `analytics-users.json` | Read-only Analytics POST body and 25 user aggregates; one page complete. |
| `validation.json` | Existing qualification replay, seven targeted gap checks, permission checks, audio access. |
| `recording-sample.mp3` | Complete downloaded recent audio proving binary access. |
| `audio-sample-provenance.json`, `recent-form-call.mp3` | Recent outbound Form Lead phone-match audio and provider/time/size provenance. |
| `ai-pricing.json` | Live public Gateway catalog pricing for selected speech/text models. |
| `ai-results.json`, `ai-transcript-*.txt` | First extraction, redacted transcripts, model usage, timing, quote checks. |
| `ai-v2-results.json` | Revised schema-validated extraction with citations attached from actual transcript sentences. |
| `ai-failure.json`, `text-ai-result.json` | Earlier free-tier failures, retained as historical evidence; these do not describe the replacement funded key. |

Mongo reads returned below the 100,001-document cap; Call Log ended normally below its 80-page bound. Mongo collections and provider endpoints were read at slightly different times on a live system. A fixed query end reduces pagination drift but cannot prevent provider records changing during collection.

## Matching actually implemented

The prototype normalizes 10-digit NANP, 11-digit leading-1, and plausible explicit `+` numbers. Production needs stricter country-aware parsing. A multi-value phone index uses operational, ingested, Granot snapshot, and original RingCentral caller evidence.

Records group by telephonySessionId, then sessionId, then Call Log ID. All 3,938 keys were distinct in this window. An external endpoint comes from the top-level inbound caller or outbound recipient, excluding extension targets and current company numbers. Nineteen internal/ambiguous sessions are excluded. External transfer-only parties in legs can be missed by this simplified rule.

All Leads sharing a number remain candidates across source and time boundaries. That is number context, not approved opportunity attachment. Old or later-created Leads can appear. Only stored provider identity is labeled exact. No matching writes occurred.

The recent Form Lead cohort uses `timestamp`, falling back to `createdAt`; activity must begin after that instant. Eligibility is current non-duplicate, not Bad Lead, not Booked, not Cancelled. Business hours, imported timestamps, and ingestion origins are not normalized for the exploratory latency calculation.

A connected participant is a User extension on a provider-connected record/leg, excluding Monitoring legs. This does not establish human conversation or precise participant duration. Outbound involvement may include transfer participants. The rep table uses Analytics live-talk segments, not the debugging whole-session-duration upper bound retained in analysis.

Rep name candidates require exact normalized full-name or first-token equality to an Active Agent name/alias. These are unverified. Candidate Booking credit uses that candidate Agent ID's actual allocations for the fixed book-date window. It is not a conversion rate or approved identity mapping.

## Findings that change the design

### Existing qualification is healthy in this window

The actual `vetRingCentralCallLogRecord` function with the Operations Registry snapshot produced 53 qualifying calls, all matching exact stored Call Lead identity. Do not widen the 120-second qualification rule to obtain intelligence coverage.

Five RingCentral Inbound Numbers are configured for attribution, versus 61 provider company numbers. This does not imply 56 missing advertiser mappings: user lines and service numbers need different classification.

### Number chronology is useful

There are 1,336 observed external numbers; 382 have no candidate Lead. Seven recent eligible Form Leads have no observed post-ingestion call, independently checked by primary-phone-filter queries.

Example `41219c0d278e` (ending 7333) shows four outbound provider-connected sessions by the same rep across several days, followed by an inbound voicemail near the cutoff. One Form Lead is a phone candidate. The timeline exposes the return contact; a cumulative call count loses it.

Preview buckets are exclusive: 356 numbers display “Number without Vantage Lead,” while 382 have no Lead in total, because 26 appear in unanswered-inbound review. Booking context takes precedence over callback review. These are demonstration buckets, not the final opportunity-state model. A later inbound conversation can also resolve an apparent missing outbound callback; the current review heuristic does not adjudicate that.

### Queue fan-out is not rep failure

The window has 5,083 `IP Phone Offline` legs and 5,950 `Stopped` legs. They are routing observations, not 11,033 failed customer outreach actions. There are 139 external sessions with multiple connected User participants. Transfers, ringing, monitoring, and overlapping time must be separated.

### Metadata access is broader than feature access

Call Log, directory, queues, and Analytics succeeded. Presence and RingSense returned 403; company-recording and RingSense permission checks returned false. Five of eight audio samples were playable. This supports partial recording access, not complete account-wide audio.

No subscriptions were visible to the current app/user. This is not proof the account has none. No subscription or RingCentral setting was changed.

## Rerun

From `vantage-main-server`, in PowerShell:

```powershell
$env:RC_TOKEN_STORE = 'file'
$env:LOG_LEVEL = 'error'
node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/dev_ops/ringcentral/sales-intelligence-probe.ts
node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/dev_ops/ringcentral/sales-intelligence-analytics.ts
node scripts/dev_ops/ringcentral/sales-intelligence-analyze.cjs
node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/dev_ops/ringcentral/sales-intelligence-validate.ts
node scripts/dev_ops/ringcentral/sales-intelligence-preview.cjs
```

Set the token store before imports: auth constructs its store at module initialization. Credentials remain in `.env`. Probes overwrite local snapshots; preserve a dated copy first if needed. They do not write Leads, Bookings, assignments, subscriptions, calls, or messages. The Analytics POST is a read-only query.

Optional funded AI experiment:

```powershell
node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/dev_ops/ringcentral/sales-intelligence-audio-sample.ts
$env:PROBE_STT_MODEL = 'openai/whisper-1'
node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/dev_ops/ringcentral/sales-intelligence-ai.ts scripts/dev_ops/ringcentral/output/sales-intelligence/recent-form-call.mp3 ringcentral-recording-samples/05-outbound-844s-3760606785022.mp3
node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/dev_ops/ringcentral/sales-intelligence-extract-v2.ts
node scripts/dev_ops/ringcentral/sales-intelligence-preview.cjs
```

The longer second recording predates this investigation and is excluded from seven-day metrics. The AI runner limits input to three files under 5 MB each, disables automatic retries, and allowlists Whisper/Grok STT plus Luna. It writes redacted transcripts; the baseline redactor is not a complete PII classifier. `sales-intelligence-text-ai.ts` separately tests the already-seeded redacted Lead Conversation; that earlier free-tier experiment failed and is not the successful fresh-audio run.

## Verification

Complete pagination and collection bounds checked; existing qualification replay reconciled 53/53 exact identities. All seven targeted gap queries returned 200/zero/no-next-page. Number timeline counts reconcile to 3,919 external sessions; hashes are unique in this snapshot; first-outbound delays are nonnegative or unknown. Analyzer, preview generator, and embedded browser JavaScript parse. Browser checks verified the gap table, number filtering, a five-event timeline, 24 rep rows, the funded-AI coverage status, and 11 sentence-linked conversation findings.

This is research code with one-off heuristics and fixed explanatory copy, not a production authorization or mutation UI. No runtime code changed, so broad server tests were not required. Production acceptance tests are in the specification.

