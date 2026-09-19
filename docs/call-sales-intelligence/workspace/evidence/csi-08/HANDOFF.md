# CSI-08 operational workflows — local handoff

Continues CSI-07 and preserves CSI-13 and the design export. Admin/server remain on `sales-intelligence`, uncommitted; no reset, commit, push or deployment. Scope authority is Team E's September 19 remaining CSI-08 handoff, not its older CSI-18/14 kickoff.

**Status: CSI-08 complete locally.** Required checkpoint was run; all automated checks passed but its final reviewer rejected inaccurate documentation in an isolated, unapplied CSI-14 proposal. No independent final approval is claimed. This does not close CSI-14 or authorize applying that patch. Full Admin lint still has unrelated baseline failures; focused CSI checks pass.

Delivered: Number search/filter/keyset pages; Attention filters/snapshot pagination/expiry; URL-selected Number/Outreach and review-only Lead paths; candidate and manual attachment decisions; follow-up create/patch/complete/snooze/cancel; overall/action assignment, notes, mark-worked, wait, close/reopen; explicit revision reconciliation and durable unknown-outcome retry; Number timeline and official links/Lead/latest-call facts; restrictions/review decisions; Reps stored read/review. Business rules remain in main-server. [Intake](INTAKE.md), [checks](CHECKS.md), [source provenance](SOURCES.md), [review](REVIEW.md).

## Run the real local preview

From `vantage-admin`: `node scripts/csi07-local.mjs`. Requires installed dependencies and the existing `csi01` Mongo replica PRIMARY at `mongodb://127.0.0.1:27189/?replicaSet=csi01`; if stopped, `docker start csi01`. Do not replace/drop the container. Open `http://127.0.0.1:3108/sales-intelligence`; real API is 3107. Wait for both ports before signing in. Stop the launcher to stop its children.

Only `testvantagemovers_csi07preview` (operations) and `vantage_admin_csi07_preview` (auth) are used. Private disposable password/config is in OS temp `vantage-csi07-local/session.json`; never copy it into evidence or output. Accounts: `owner@csi07.example.test`, `admin@csi07.example.test`. Restart rotates credentials; sign in again. Runtime log: temp `vantage-csi07-local/api.log`. Existing fixture decisions persist. API origin remains server-only. The launcher enables the attachment gate only locally; media/STT/AI/nudges/capture/providers remain off. Existing Outreach worker runs serially every five seconds to publish Attention; production cron is unchanged.

From `vantage-main-server`, `pnpm exec tsx scripts/test-csi08-local.ts seed` adds guarded synthetic pagination/Lead/Rep/restriction fixtures without overwriting Owner decisions. Then `pnpm exec tsx scripts/test-csi08-local.ts` runs real auth/BFF/API proof. Other modes: `idle-revision`, `clock-regression`, `note-regression`, `lead-identity-regression`, `change`, `clock-ui`. These write synthetic records only. `expire-attention` expires exactly the snapshot captured by the browser in this evidence packet; refresh the URL artifact before reusing it. Replica suites create/dispose randomized isolated test databases.

Useful fixture Numbers: 0101 multi-action/history/retry (Outreach ending 721); 0103 manual attachment; 0104 Morgan attachment/wait; 0106 Taylor official cancellation/voicemail/restriction; 0107 Riley Call Lead; 0140–0193 pagination. Reps account `csi08-synthetic`. Review-only Lead ending 1005 is an intentional orphan, not an official-record destination fixture.

## Boundaries and remaining projects

No overview API exists; Attention q/source_label are not supported and are not fabricated. Reps requires account ID and stored directory; metrics remain unknown. Reps create/propose/retire UI is outside the requested read/review slice. Number activity dates are supported API/URL inputs; the current UI exposes classification, connection and hygiene filters. Production hosting/capacity/permissions are unverified CSI-16 work.

CSI-14 remains disabled pending its recorded P2 and dedicated preview/send integration. CSI-18 corrections/reanalysis, CSI-09 full Coverage/settings/Lead entry points and CSI-15 backfill/retention remain separate. The prior checkpoint's unrelated CSI-12 proposal was not applied. See REVIEW.md for the new checkpoint outcome; do not infer production readiness from synthetic local acceptance.
