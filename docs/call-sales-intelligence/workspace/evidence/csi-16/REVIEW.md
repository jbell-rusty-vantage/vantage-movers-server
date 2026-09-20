# CSI-16 independent evidence review

Reviewer: the one Owner-authorized GPT-6 Astra subagent. Scope: evidence lineage, scenario mapping, G2/G3 contract consistency and read-only MCP inspection. This review does not run providers, touch production, change fixtures, or certify deployments. Final packet honesty review is recorded below; checkpoint and final harness validation outcomes remain separately owned by CHECKS.

## Fresh reviewer check

`node --import tsx --import ./scripts/test-setup.ts --test src/services/salesIntelligence/analysis/contracts.test.ts` exited 0: **3 passed, 0 failed, 0 skipped**. The generated MCP prompt, schema digest, envelope and every tool argument schema exactly match main-server authority. Closed arguments reject arbitrary tool names, Mongo operators, arbitrary URLs, authority and excessive pages. The sibling MCP artifact was present: this was not the isolated-checkpoint parity skip.

Read-only inspection of MCP `lib/intelligence/{auth,api,registration}.ts` found twelve bounded tools; both dedicated key and signed run token are required, registration uses the request-local signed allowlist, the server remains authority for nonce/lease/evidence, and uncertain submission is never automatically retried. No Owner command, Lead creation, message send or arbitrary Mongo tool is registered. Existing MCP formatting dirt is preserved. This is source/contract consistency, not a fresh deployed transport or capability probe.

## Scenario-to-proof map

This table identifies concrete existing assertions; it is not the G5 execution record. Fresh outcomes belong in CHECKS and browser-specific outcomes in ACCEPTANCE. Historical proof is fingerprinted in SOURCES and remains dated.

| Acceptance | Relevant assertion/source | Limit / owner of missing proof |
| --- | --- | --- |
| 1 Arrival / coverage | Outreach units: staffed 30/15-minute clocks, DST/day-only dates; CSI-09 Coverage and CSI-15 stored counts/watermark/gaps | Team F must exercise the specific Saturday/Monday boundary in current acceptance; provider coverage is G6 |
| 2 Inbound | Outreach replica: human versus missed, unknown/voicemail and exact outcomes | Team C owns attribution; browser display separately Team E/F |
| 3 Full envelope | Runtime replica: real ToolLoopAgent/local MCP handlers, pinned prompt/schema/evidence, typed submission and application | Fake model and captured synthetic transcript; no actual STT or live model quality claim |
| 4 Multiple obligations | Outreach replica: three independent actions including undated; individual completion and snooze | UI arrangement must be walked separately |
| 5 Responsibility | Outreach replica: Alex/Jordan/Casey; Owner correction and repeated promise; unknown remains unassigned | Official receiver/Booking allocations are not changed by CSI authority |
| 6 Waiting | Outreach replica: independent estimate survives wait; expiry never rewaits; repeat misses preserve first deadline | Day-only cutoff UI needs separate inspection |
| 7 Owner control | Owner replica exact-version confirmation/correction/retraction; runtime original/current reruns, explicit correction context and no carried confirmation | Live model assessment is unprobed; UI receipt/draft proof separately CSI-18/current G5 |
| 8 Restrictions / closure | Outreach replica: restriction pauses without rewriting, closed new request remains closed/review, official closure while identity blocked | No send or official record creation authorized by these fixtures |
| 9 Ambiguity / Booking | Attachment replica concurrent event-time and Owner authority; Outreach conversation authority denies candidates and foreign pointers | Team C owns any ambiguous effect defect; Team E UI resolution separately |
| 10 No Lead | Outreach old mapped missed traffic / Number Review; runtime eligibility and number-only restrictions; media eligibility | No fabricated Lead; no live-call qualification assertion |
| 11 Durability | Capture, attachment, Outreach, intake and runtime replicas: replay/CAS/lease, same receipt, batch cursor, missing queue wakeups | These are local replica proofs, not multi-node failover or deployed queue proof |
| 12 History | CSI-15 backfill/retention; runtime original/current evidence; fulfilled/official closure barriers | Fleet backfill and operational day range remain separate; original rerun is unavailable after purge |
| 13 Budget/audio | CSI-15 budget/period/media proofs: stage-preserving budget/permission pause, cap resume, exhausted eighth claim | Current recording grant and actual billing are G6; no recording cannot mean no calls |
| 14 Owner message/UI | CSI-14 destination replica: current directory User, customer destination guards, unknown-delivery repair/idempotency; CSI-07/18 browser state | Fuller dialogs/history belong CSI-14 AFTER-16 B; live send remains unrun |

## Integration audit boundaries

- G2 operational components and isolated browser proofs exist; do not leave its row `Not started`, and do not call it deployed.
- G3 real SDK/local HTTP MCP/fake-model processing exists with exact evidence and Owner intervention; distinguish this from paid Gateway/STT/live model acceptance.
- G4 historical evidence may be reused with fingerprints, but a passing old result is not a fresh regression. New failures retain their exact owning issue and immutable fixture.
- G5 needs expected/actual, redacted artifact and pass/fail/not-run/capability-blocked for every numbered scenario plus separate integration bullets. Named subjects are read-only Lead Outreach examples; they cannot stand in for media, Number Activity or attachment proof.
- G6 each row requires its own source and probed/not-probed/capability-blocked state. Historical recording denial, configured source defaults and deployment SHAs read from Git do not establish current capability or deployed revisions.
- The CSI-15 broader failed checkpoint stays failed. Prior CSI-17 and stale CSI-07 checkpoints are also not silently promoted to current-source approval.
- CSI-10 empty-recording discovery replay remains a separate known limit; CSI-14 destination/P2 is already delivered, but fuller dialogs/history are not. No changes to either belong in CSI-16 certification.
- Owner plans full-system cutover after CSI-16. The packet must preserve that plan while stating that cutover has not occurred in this issue. No rollout gate is satisfied merely by restamping prose.

## Concrete integration finding identified during review

**CSI-16 integration bullet: no demo replay claim in live panel — unresolved at initial inspection.** Admin `components/conversations/conversation-panel.tsx:138` unconditionally renders “This run was a replay of already-paid artifacts, not a live AI Gateway call.” Its generic `ConversationDetail` input does not establish that claim. `tests/conversations-page.test.ts:173` expects that text. This is an existing conversation UI integration gap (Team E, CSI-07/CSI-16 acceptance accounting), not evidence that any given run was actually replayed. Record it as a failed source integration assertion unless corrected and revalidated by the coordinating agent. No source or test was edited by this reviewer.

Signed-audio behavior is separately present in `ConversationPanel`: the signed URL is fetched in the Play handler only (around line 190), and the existing conversation test checks that mount does not request audio. This source/test evidence cannot replace browser Play proof and does not authorize inventing media for the named subjects. The CSI-10 empty-recording replay gate is also still present at server `repIdentity/worker.ts:41`.


## Fresh CSI-16 media failure — assigned to its owning issue

**FAIL — CSI-11 / Team B, shared CSI-01 jobs seam / Team A.** The coordinating agent's fresh `node --import tsx scripts/test-csi-media.ts` run reports 18 passed / 2 failed (one failing leaf and its containing suite). The unchanged assertion `scripts/test-csi-media.replica.test.ts:164` in “429 honors Retry-After or default without burning failure attempts” expected `1789864002851`, actual `1789864002891`: 40 ms later.

Source inspection supports the exact clock discrepancy: the test injects a fixed `now` into `runMediaFetchJob`; `conversations/media.ts:137` supplies explicit `resumeAt` only for `permission_denied`, not `throttled`; `jobs.ts:249` therefore computes `Date.now() + delay`. The projected conversation timestamp comes from that job outcome rather than the injected worker time. This is a failing retry-timing assertion, not a recording-permission denial or a pass. The observed 40 ms later timestamp alone does not establish a premature provider retry, but it prevents certification of the exact Retry-After test contract. No B–E fixture or runtime file was changed to conceal it. Resolution and fresh proof belong to CSI-11/Team B with Team A for the shared scheduling seam.

Reported fresh successful runs (coordinating agent; exact commands/logs recorded in CHECKS): backfill 14, retention 10, budget 13, period 4, Outreach 24, runtime 23, Owner 6, capture 12, attachment 12, nudges 18; focused server 140 with no skips; Admin 15 plus typecheck; scoped server typecheck. Full server typecheck still reports the three preserved external-probe TS18046 errors and is not green. These results do not supersede the media failure.

## Coverage review clarification

The final `local-http.json` has `backfill.available:false` and `days:0` with the complete stored-count/watermark/gap/note contract. Source `backfill/coverage.ts` defines executable planning availability as `days > 0`. This is legitimate disabled historical planning with implemented workers, not the intake stop condition of missing CSI-15 implementation. The reviewer's initial suspicion that this field necessarily represented stale pre-restart API output was incorrect. The coordinating agent reports correcting the new CSI-16 harness's corresponding assumption and rerunning; no CSI-15 fixture was changed. Browser Coverage's retained 25-minute first-action setting is an existing Owner override; the separate default-clock proof uses accepted 30/15-minute defaults and must not claim the preview setting was 30.

## Final packet honesty review

Inspected the populated INTAKE, CHECKS, HANDOFF, G6, GAPS, ACCEPTANCE execution matrix, test-result excerpts, current browser/HTTP artifacts, new local harness and server restamp diff. **No additional material evidence misstatement found.** This approves the evidence accounting, not all-green product readiness: F-01 media retry assertion and F-02 generic replay copy remain failed; combined walkthrough sequences that were not exercised remain not-run/capability-blocked; all eight current production capability rows remain not probed. Exact replica counts match the recorded output excerpts. The fresh default-clock calculation is correctly distinguished from the existing preview's 25-minute Owner policy.

The browser ownership/correction artifact substantiates Casey assignment while retaining Promised by Jordan and Outreach owned by Alex, with separate audit entries. Inbound artifacts retain Connected status does not establish human contact / Voicemail—speaker unknown and Last meaningful contact Not observed. Named-subject preview 404 reads are not presented as a successful named-subject browser walk. The local harness performs fixed-loopback domain GETs plus local authentication, checks the guarded session/database settings, and invokes pure default-clock helpers; it makes no provider request or production write.

All newly added Markdown link targets inspected resolve. A whole-document scan of the older catalog reports pre-existing unrelated missing targets; no new CSI-16 link was among those failures. Original tracked CSI replica fixtures have no diff. FILES was not yet present at this inspection; the coordinating agent was asked to finish that required manifest. Required Composer checkpoint and final harness typecheck/lint were still running, so **no checkpoint PASS or final harness check result is claimed by this review**. Their eventual outcomes belong in CHECKS and a dated closure entry.


## Required Composer checkpoint — first review (coordinator addendum)

Run `1789864581589-7eeea0fd`, input HEAD `561e048960cd914f37a337addada8b459b5296f1`, fingerprint `16b316b2bc9e2d6890a13b5c1a941550036a18ff39a934fb19b0be713b7da622`, command `pnpm finish-work --provider cursor --model composer-2.5 --no-apply`. The accumulated baseline includes older CSI implementation; this is not a review of only the certification diff. Initial review is **not clean for merge** for runtime media retry scheduling and external probe typecheck. F-01/F-03/F-05 were already recorded. Additional source-confirmed pending-recording delay omission is filed as F-07; no old fixture is changed. It also repeats low-priority malformed-input 403 and generic-500 INVALID_INPUT observations already present in CSI-15 review; those are not represented as new fixed work. Cleanup and final gates remain pending until the final report below. No isolated patch is applied.
