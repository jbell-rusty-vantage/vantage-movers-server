# CSI-08 local checks — September 19, 2026

All runtime proof is synthetic and persisted in the guarded loopback replica. No production data, external provider calls, deployment, paid analysis or messages.

## Source checks

- Admin `pnpm test`: **626/626 pass** (`admin-tests.txt`), including six CSI command/date/scope/retry tests. Full `pnpm lint`: **11 errors / 7 warnings** in unrelated existing reporting/global-search and other host files (`admin-lint.txt`); not a clean full lint claim. Focused CSI lint and Admin typecheck pass (`admin-focused-lint.txt`, `admin-typecheck.txt`).
- Server typecheck passes (`server-typecheck-final.txt`). Earlier failed output is retained as `server-typecheck.txt`; the Lead subject model literal typing was corrected.
- Real replica suites: Number reads **10/10**, attachment **12/12**, Outreach **24/24** (`server-*-replica-final.txt`). The added attachment test proves absent-pair creation, durable replay, one audit and unchanged official phone. Earlier read assertion/audit test-query failures are retained separately and corrected in the final runs.
- Guarded API proof passes (`api-proof.txt`): immutable Attention pagination/no overlap, suffix search, attachment availability, targeted reviews, replay/same response, changed-payload rejection, stale revision rejection, Admin and Historical denial.
- Reproduced and fixed: idle clock revision churn; accepted completion-note loss; Lead-scoped identity resolution rejection; absent-pair null audit prior. Guarded runner modes `idle-revision`, `clock-regression`, `note-regression`, `lead-identity-regression` passed. `manual-attachment-regression` exposed required prior validation; final replica and browser tests prove its correction.

## Browser acceptance

Actual Owner sign-in, authenticated BFF and API, with synthetic local records:

- Multiple independent follow-ups: create undated availability work assigned Casey while overall Alex; complete one without completing others; edit another with due null; cancel independently. Snooze preserves the original overdue promise. Close cancels open work, reopen retains cancelled history (`close-reopen-history.txt`).
- Live revision change while editing: focused description and selected Agent/null date retained, Save blocked until explicit acknowledgement (`draft-conflict.ax.txt`, `draft-conflict-desktop.png`).
- Lost successful assignment response injected at browser response stage: unknown-result form freezes payload; Retry returns `replayed:true` with exactly the same key/body/result (`browser-retry.json`, `lost-response-desktop.png`). Network interception was removed. Overall Jordan and action Casey remain separate.
- Mark worked does not imply human contact; explicit wait with future due (`attachment-wait.txt`). Candidate attach/detach/reject preserves decisions (`attachment-decisions.txt`). Manual host search proves no implicit attachment; explicit absent-pair confirmation succeeds (`manual-attachment.txt`).
- Review-only orphan Lead can be inspected/dismissed (`review-only-lead.txt`, `review-only-mobile.png`). Its missing official record is intentional; actual official destinations are proven with separate persisted Morgan/Taylor/Riley records.
- Active restriction blocks review dismissal and retains reason (`restriction-blocked-mobile.png`); lifting it enables dismissal while officially cancelled Outreach stays closed (`restriction-resolution.txt`). Provider-connected unknown call and latest voicemail are not labelled human contact; absent recordings/analysis remain explicit.
- Reps reads stored account/directory and reviews an existing proposed identity (`rep-review.txt`, `rep-review-desktop.png`); unknown metrics and disabled messaging remain explicit.
- Number keyset pagination (`number-pagination.txt`), immutable Attention second page, then test-only expiry and reload preserve selected Number/Outreach while removing only expired Attention cursor (`attention-pagination-url.txt`, `expire-attention.txt`, `attention-expiry.txt`).
- Timeline Load older activity reveals actual older events (`timeline-pagination.txt`). Offline browser misses a real BFF note, then reconnect refetches it with the same selection (`reconnect-offline.txt`, `reconnect-online.txt`, `reconnect-command.txt`).
- A new follow-up due 45 seconds ahead becomes contractually overdue through live clock refresh, without another command (`clock-before.txt`, `clock-after.txt`, `clock-ui-command.txt`).
- Native dialog initial textarea focus, Tab to Save, Escape returns focus to Add note and leaves detail open (`keyboard-dialog.json`). Narrow 390×844 viewport has scrollWidth 390; controls and follow-up remain readable (`command-mobile.png`). Desktop and narrow screenshots are actual browser captures. Temporary viewport/network overrides reset after proof.
- Official Form Lead, Call Lead, Booking and Cancellation routes use host `database_scope=production`, load actual records and retain Current scope (`official-*.txt`). API `scope` was insufficient for host navigation and was corrected.

## Required quality checkpoint

Ran `pnpm finish-work --provider codex --no-apply`: run `1789816163516-89bcb4b3`, overall **failed / CLI 1**. All automated checks passed: typecheck, lint, offline **2,432 pass / 115 skip / 0 fail**, quality-runner **12/12**. Final review rejected inaccurate prose introduced by its separate CSI-14 proposal. The entire proposal remains unapplied. [REVIEW](REVIEW.md) records the exact distinction; no independent final approval is claimed. Source checks above remain separate from that isolated snapshot and from CSI-07's earlier checkpoint.

The final Admin change clarifies unknown-outcome error wording in attachment/review dialogs. Its focused lint/typecheck passed (`admin-focused-lint-final.txt`, `admin-typecheck-final.txt`). Export handoff/contract/validation/CSS hashes still match the CSI-07 inventory; MCP remains clean. Runtime provider/network flags were not broadened.
