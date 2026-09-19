# CSI-14 destination + P2 review

Source versus checkpoint are separate. A stale, blocked, abandoned, or isolated snapshot is not independent current-source approval.

Required command in this Cursor session: `pnpm finish-work --provider cursor --no-apply --model composer-2.5`. Cursor quality from this point uses Grok 4.6, Auto, or Composer 2.5 only — not GPT.

## Source (this checkout)

Directory-User destinations, optional reviewed-link metadata, per-extension rate admission, and P2 review-context fail-closed validation are in the working tree on `sales-intelligence` HEAD `bbdfe4c2ea080f4a962d74913baed0846c1ac763` (dirty). Admin Message-rep picker is on `905fe8777e5707f20b32b2a76c59a3566dafaf09` (dirty). Remotes `jbell-rusty-vantage`. No commit/push.

Direct source checks after the observability integration: focused identity/nudge **18 pass / 0 fail**; earlier replica **18 / 12**; Admin client **9 / 9**; server typecheck/lint exit 0. Live send was not run. `NUDGE_ENABLED` stayed off outside the replica wrapper.

After inspecting the Composer patch, source gained only the customer-destination observability shape (`OutreachRecord`, not a synthetic Owner Rep Nudge id) plus a unit assertion and the Service sentence. The isolated auto-resolved-link revision-fence and wholesale docs rewrite were **not** applied: Admin already sends `rep_identity_link_id` + `expected_rep_revision` when a current reviewed link exists, and omits both when it does not.

## Earlier failed / abandoned runs (not the required result)

| Run | Provider / model | Status |
| --- | --- | --- |
| `1789833373594-03239262` | `--provider grok` | **failed** immediately: `Unknown provider: grok` |
| `1789833463209-54f78e7b` | `--provider cursor` (default) | **failed** at review: model-provider usage-guideline block |
| `1789833853774-c0b4165b` | `--provider cursor --model gpt-5.2` | **abandoned** at cleanup after Owner instruction; no patch applied |

## Required isolated checkpoint

`pnpm finish-work --provider cursor --no-apply --model composer-2.5`

- Run `1789834716855-f5ff3f75`
- Input HEAD `bbdfe4c2ea080f4a962d74913baed0846c1ac763`
- Fingerprint `2613b569853c14fb227f00d1ab7d99b646a2e581287551f3a80f612f1a73d218`
- CLI exit 0, status **patch-ready** (`--no-apply`)
- Isolated checks: typecheck, lint, offline **2437 pass / 115 skip / 0 fail**, quality-runner **12/12**
- Final review **QUALITY_RESULT: PASS**

Reports retained here as `checkpoint-review.md`, `checkpoint-cleanup.md`, `checkpoint-docs.md`, `checkpoint-verify.md`, `checkpoint-result.json`. Isolated workspace and `changes.patch` remain under `.git/vantage-quality/runs/1789834716855-f5ff3f75/`.

Inspected findings before any source edit:

- Customer-destination operational entity used an Outreach id as `OwnerRepNudge` — **integrated** into current source and unit-tested.
- Auto-resolved reviewed link without `expected_rep_revision` — **left in the isolated patch**. Current Zod pairing plus Admin explicit-link send already cover the picker path.
- Legacy `rc_*` / `nudge_extension_created` ops gap — documented limit; official `migration:csi:indexes` still not applied.
- Team Messaging person id only on reviewed links — documented product limit, not a defect.

No isolated patch was applied wholesale. Source fingerprint advanced after the observability integration, so this snapshot is not final current-source approval even though its own checks and final review passed.

## Out of scope

CSI-15, fleet backfill, live send, subscriptions, CSI-07/08 dashboard restarts, fuller CSI-14 dialogs/history (next session), identity writes for Josh, Roy, Jason, either Tyler, Russell, QA, or unmatched Users.
