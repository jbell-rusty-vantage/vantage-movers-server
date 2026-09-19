# CSI-18 review and checkpoint outcome

Required command: `pnpm finish-work --provider codex --no-apply`.

Checkpoint `1789822049070-ce55fc86` examined an isolated server snapshot at HEAD `cc67bdfdc2a5738f8c876af187b0317eb34b1a1d`, input fingerprint `0a9b556adabe6431ab1c2eb358385faead165ae53472bba17e9756c03bf44ec0`. Its initial review found one P2: a Number analysis could read an explicitly obsolete transcript and publish from stale captured sources.

The five-file proposal was inspected in full. The owned read guard, source-set helper and their tests were adopted (`owned-freshness.patch`). Its blanket application pause was **not** adopted: CSI-18 must retain original-evidence historical findings. Direct source instead records those findings/assessments, blocks stale effects and current publication, and completes the run as stale with a reason. Additional real-transport regressions prove both historical replay and a Number transcript changing before publication. The Service was updated for actual current behavior, including removing historical prose claiming correction selection remained absent. No unrelated patches, manifests or lockfiles were adopted.

Snapshot results: typecheck 0, lint 0, full suite **2,433 pass / 115 skipped / 0 fail**, quality runner **12/12**, final review **QUALITY_RESULT: PASS**. Overall checkpoint status is **stale**, CLI exit **1**, because direct source evolved during the run. This is snapshot approval, not independent approval of the final source adaptation or Admin. The complete patch was not auto-applied.

Direct source after the adaptation: server typecheck and lint pass; focused analysis **21/21**; runtime transport/replica **23/23**. Owner command replica **6/6**, intelligence **9/9**, Outreach **24/24** also pass. Admin **626/626**, typecheck and focused lint pass; full Admin lint retains unrelated **11 errors / 7 warnings**. Browser/HTTP acceptance is recorded separately in CHECKS.

No unresolved CSI-18 correctness finding is known from these checks. Prior CSI-08 failed checkpoint prose, CSI-14 P2, CSI-10 empty-recording replay and CSI-12 proposals remain separate and are not closed by this work. Production/model quality/rollout acceptance remains outside the authorized local scope.
