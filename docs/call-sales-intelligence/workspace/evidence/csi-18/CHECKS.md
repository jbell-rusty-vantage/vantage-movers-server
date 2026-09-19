# CSI-18 checks

## Direct server acceptance

- `owner-replica.log`: 6/6 passed. Exact-version confirmation, durable same-key replay, changed payload and stale revision/digest rejection; immediate correction with AI disabled; immutable original assertion; unknown for absent assessments; independent/undated action preservation; authorized correction references; purge/unavailable original evidence; safe retraction and closure handling.
- `runtime-replica-final.log`: 23/23 passed through real local MCP HTTP and SDK with a fake model. Original/current evidence isolation, pinned prompt plus explicit correction context, instruction-specific disagreement, Owner precedence, no carried confirmation, purge rejection, acknowledgment/crash recovery without duplicate model invocation, current transcript checks, and retention of historical original-evidence findings without stale effects/current publication.
- `intelligence-replica.log`: 9/9 passed. `outreach-replica.log`: 24/24 passed.
- `server-lint-final.log` and `server-typecheck-final.log`: passed. `server-focused-final.log`: 21/21 passed after the freshness adaptation. An earlier overlapping typecheck was intentionally stopped under memory pressure; the final rerun passed.

## Direct Admin acceptance

- `admin-tests.log`: 626/626 passed. `admin-typecheck.log` and `admin-focused-lint.log`: passed.
- `admin-full-lint.log`: existing unrelated baseline remains **11 errors / 7 warnings**. Full lint is not green.
- `http.json` and `http-proof.log`: real Owner BFF read/confirmation, read has no effects, durable duplicate, changed-payload conflict, stale revision conflict, Admin read/write denied. `http-correction-fixture.json` preserves the earlier browser fixture.
- `admin-page-denied.json` / `.dom.txt`: actual browser sign-in as Admin, direct Sales Intelligence navigation redirected to Overview; no Sales Intelligence heading or controls. Owner session and controls were exercised separately.
- Browser: targeted correction changed only its selected action while retaining the original model assertion; Apply suggestion created a separate undated Owner-origin Review action; current-context rerun selected an explicit correction; original-evidence rerun queued and remained visibly pending with AI disabled; finding confirmation returned a version-specific receipt. Evidence/history controls use persisted server reads.
- `draft-conflict.ax.txt` / `draft-conflict-mobile.png`: live refetch retained reason/assertion/focus, required explicit revision acknowledgement and did not overwrite drafts. Keyboard Tab/Return acknowledged; Escape restored the invoking control.
- `browser-retry.json` / `unknown-outcome.ax.txt`: a lost successful retraction response froze the submitted intent; retry reused its key/payload and received the durable replay. Later Owner work was preserved and reported blocked; refresh was queued.
- `correction-mobile.png`: 390×844 viewport, no horizontal document overflow. Desktop result is recorded in `retraction-result-desktop.png`. Temporary viewport/interception overrides were removed.
- `confirm-finding.ax.txt`, `confirm-run.dom.txt`, `original-rerun.dom.txt`, `evidence-history.dom.txt`: exact review receipts, queued original rerun, retained server evidence content and append-only audit history.

## Scope and limitations

Browser reruns prove scheduling/status, not paid processing: preview AI remains disabled. The guarded runtime fixture proves processing/replay independently. No model quality, production grants, deployment, retention worker, messaging or rollout certification is claimed. Prior CSI-14 P2, CSI-10 empty-recording replay and CSI-12 review follow-ups remain separate. Checkpoint snapshot outcomes and final source checks are kept distinct in REVIEW.
