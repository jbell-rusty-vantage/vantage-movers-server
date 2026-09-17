# Implementation ledger

Created September 17, 2026. Specification and workspace prepared; runtime work below is unclaimed. Replace placeholders only with actual evidence. Valid status: not started / claimed / implementing / review / blocked / complete. Complete means implemented and relevant checks passed, not simply specified.

| Issue | Team | Status | Agent / branch / PR | Checks and evidence | Blocker / next step |
| --- | --- | --- | --- | --- | --- |
| CSI-01 | A | complete | Codex Step 2; sales-intelligence (server and admin); uncommitted review patch based on Grok 8219d2a | Server 43/43; dashboard 9/9; replica 15/15; both typechecks; isolated CLI report/verify. [Packet](evidence/csi-01/STEP2-HANDOFF.md), [checks](evidence/csi-01/STEP2-CHECKS.md), [exact owned files](evidence/csi-01/STEP2-FILES.md). | GPT-6 independently approved all five review fixes. G1 foundation contracts frozen; B–E feature services and integration acceptance remain downstream. |
| CSI-02 | B | not started | — | — | CSI-01 |
| CSI-03 | B | not started | — | — | CSI-02 |
| CSI-04 | B | not started | — | — | CSI-02 |
| CSI-05 | C | not started | — | — | CSI-01/02 |
| CSI-06 | C | not started | — | — | CSI-05 |
| CSI-07 | E (B/C services) | not started | — | — | CSI-04/06 |
| CSI-08 | E | not started | — | — | DTO fixtures then CSI-07 |
| CSI-09 | E (A/C policy service) | not started | — | — | CSI-01/04/06 |
| CSI-10 | C | not started | — | — | Directory fixture then CSI-02 |
| CSI-11 | B | not started | — | — | CSI-05/10 eligibility inputs |
| CSI-12 | B | not started | — | — | CSI-11 |
| CSI-17 | D | not started | — | — | CSI-01 scoped auth/types |
| CSI-13 | D | not started | — | — | CSI-06/10/12/17 |
| CSI-18 | D + E | not started | — | — | CSI-08/13; coordinate C commands |
| CSI-14 | C + E | not started | — | — | CSI-06/08/10 |
| CSI-15 | F (B/D adapters) | not started | — | — | CSI-02/06/12/13 |
| CSI-16 | F | not started | — | — | Integrated delivery |

## Specification validation

September 17: interview revision and subsequent server/Admin/MCP codebase audit completed. Current 07 is the future Claude design intake contract; its former contents are archived under history/. 08 remains historical evidence, and 09 records decisions. See [11](../11-codebase-alignment-audit.md) for inspected integration gaps and team adaptations.

Documentation validation: 24 active pack/workspace documents, 110 local links including referenced heading anchors, code fences/conflict markers, all 18 issue ids, six team briefs, $80 configuration and scoped submission contract passed. `git diff --check` passed after whitespace cleanup. These are documentation checks only; no runtime implementation tests, live provider actions or future design-artifact review were performed.

September 17 (later): portable [RingCentral capability summary](RINGCENTRAL-CAPABILITY.md) added for agents from the Sept 14–15 proofs. `scripts/dev_ops/**` remains gitignored. Not a renewed production probe.

## Integration notes

September 17 CSI-01 preparation: [handoff](evidence/csi-01/HANDOFF.md). Envelope module `csi-envelope-v1` recorded in [CONTRACTS.md](CONTRACTS.md). G1 freeze remains pending.

Append dated handoffs, contract changes and remaining capability checks here or link an issue-specific artifact in `evidence/`. Keep sensitive/provider data out of this workspace. Do not turn a denied recording permission into a zero-data pass.

## CSI-01 Step 2 ownership — Codex, September 17, 2026

Status: complete — independent GPT-6 review approved and G1 foundation contracts frozen. Clean server baseline `8219d2a`; clean dashboard baseline on `sales-intelligence`. Grok's committed patch and original handoff are preserved. This task is the sole writer assigned here; no other checkout is switched or reset.

Owned server files: `src/config/domain/salesIntelligence.ts`, `src/config/domain.ts`, `src/config/domain/conversations.ts`; `src/models/salesIntelligence/*` and new CSI model accessors; `src/models/LeadConversation.ts`; `src/validation/intelligence/*`, `src/validation/v1/salesIntelligence.ts`, `src/validation/v1.validation.ts`; `src/services/salesIntelligence/{dto,auth,transactions,jobs,aiBudget,policy,evidence}.ts` and their tests; `src/services/conversations/reads.ts`; `scripts/migrations/sales-intelligence*`; isolated replica test runner; this workspace's CONTRACTS/LEDGER and `evidence/csi-01/STEP2-*` review artifacts. Any additional compatibility files will be listed in the final packet before handoff. Dashboard edits limited to existing conversation nullable-metadata compatibility if required; no screens.

Reuse: `db.withTransaction`, `durableWork/checksum.canonicalJson`, existing Registry Owner verifier, `runtime.getMongoDatabaseName`, report/apply/verify migration conventions. New CSI ledger/audit avoids widening official command origins or EntityChange entities. No production database, provider, queue, subscription or messaging actions authorized or performed. Independent GPT-6 review replaced Fable at the Owner’s request; all substantive findings are resolved.

## CSI-01 compatibility ownership addendum

September 17 review closeout: at the Owner's request, a separate GPT-6 (`gpt-6-astra`) subagent replaced Fable. It found five substantive issues, then independently approved their fixes and G1 foundation freeze. [Review history and approval](evidence/csi-01/STEP2-INDEPENDENT-REVIEW.md). Added review ownership: this report, document 02's budget activation clarification, and the existing owned auth/validation/model/job/budget tests and modules. Runtime fixes: closed dynamic run-route templates; exact Owner command targets; immutable finding/run provenance; cross-deployment dedupe conflicts; once-only budget-period activation. Verifier also checks stored job subject/dataset. Main server 43/43 focused tests and 15/15 replica tests; reviewer 9/9 focused and 15/15 replica plus adversarial exploit replays. No remaining substantive CSI-01 findings. G2–G6 are unchanged.

Additional exact files: `src/models/EntityChange.ts` is read-only (scan index is applied by CSI migration); `src/routes/sales-intelligence-boundary.routes.ts` and test, `src/routes/v1.routes.ts`; `scripts/migrations/lead-conversation-indexes.ts` (prevent old index CLI bypassing account-attribution readiness); `src/models/LeadConversation.test.ts`; server `src/services/salesIntelligence/{fixtures,foundation.test}.ts`; dashboard `lib/api/conversations.ts` and `components/conversations/conversation-presentation.ts` for nullable metadata only. New model filenames are enumerated in `src/models/salesIntelligence/registry.ts` and the final changed-file manifest.

Final ownership additionally includes `src/middleware/requireApiSecret.ts` (dedicated CSI key hard route scope), `package.json`, `scripts/migrations/README.md`, `scripts/test-csi-foundation.ts`, `scripts/test-csi-foundation.replica.test.ts`, `docs/index.md`, `docs/knowledge/services/sales-intelligence-foundation.md`, `docs/call-sales-intelligence/04-server-routes.md`, and dashboard `tests/conversations-page.test.ts`. [STEP2-FILES.md](evidence/csi-01/STEP2-FILES.md) enumerates all actual files, including test evidence. No feature flags enabled in deployment; no production action performed. Independent review and substantive finding resolution are complete; see STEP2-INDEPENDENT-REVIEW.md.
