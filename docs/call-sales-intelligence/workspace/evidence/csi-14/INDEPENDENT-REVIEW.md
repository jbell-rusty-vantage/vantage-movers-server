# CSI-14 current-source independent review

Reviewer: GPT-6 Astra subagent `/root/review_csi14_next`, explicitly requested by the Owner after CSI-14 handoff. Reviewed September 18, 2026. This is separate from both earlier isolated quality checkpoints.

Observed repository: `C:\Users\Pinda\Proyectos\vantage\vantage-main-server`; branch `sales-intelligence`; HEAD `3355c6dcf68ed2c092824dc1dbb87c71a3f0c343`; remote `https://github.com/jbell-rusty-vantage/vantage-movers-server.git`. Existing dirty CSI-10/14 work was preserved. Review was read-only; parent changes for this request are review/handoff documentation only.

## Verdict

**One verified P2 finding, unresolved. Current CSI-14 does not receive clean approval.**

Scope: current nudge implementation, its tests and evidence, and immediate CSI-06/10 identity/Outreach dependencies. No additional concrete bug was found in the inspected idempotency, durable submission/receipt ordering, repair-only recovery, temporal identity authority, destination guards or narrow Outreach integration. This is a bounded review, not certification of the whole app, all previous CSI issues, or live provider capability.

## P2 — Edited review-context bodies can bypass contact restrictions

Location: `src/services/salesIntelligence/nudges/templates.ts:29`, with the purpose-specific gate at `src/services/salesIntelligence/nudges/eligibility.ts:102`.

The regex checks only some imperative forms. Actual `renderNudgeTemplate` execution accepts `Alex, call the customer tomorrow.` and `Please urgently call the customer.` under `purpose: review_context`. Its control case `Please call the customer.` throws `NUDGE_NOT_ACTIONABLE`.

Contact eligibility, active call restrictions and applicable call-action checks are deliberately applied to `call_suggestion`, while review context remains available to discuss restricted work internally. These accepted edits turn that internal context into an instruction to contact the customer without passing the call-suggestion gate. This violates the purpose boundary in pipeline §8.1. It is still an explicit Owner-to-rep message; it is not an automatic or direct customer send.

Recommended correction: make the restricted-work review path structurally incapable of conveying editable contact instructions, or use conservative deterministic validation that fails closed for contact-related edits. Adding only these two regex examples is not a sufficient general correction. Preserve legitimate internal discussion of restrictions and the documented edited-body workflow. Add unit cases plus a replica scenario proving restricted-work preview and send reject prohibited edits before any provider adapter invocation.

No runtime fix was made in this review/instructions task. Close this finding before calling CSI-14 review-complete or enabling live messaging. Keep its remediation separate from CSI-17 scope.

## Fresh checks performed by the reviewer

Working directory for both successful commands: `C:\Users\Pinda\Proyectos\vantage\vantage-main-server`.

```powershell
node --import tsx --import ./ops/test-setup.ts --test src/services/salesIntelligence/nudges/*.test.ts
```

Actual summary:

```text
ℹ tests 11
ℹ suites 0
ℹ pass 11
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 5865.0556
```

Adversarial reproduction:

```powershell
node --import tsx --import ./ops/test-setup.ts -e 'const {renderNudgeTemplate}=require("./src/services/salesIntelligence/nudges/templates.ts"); for (const body of ["Please call the customer.", "Alex, call the customer tomorrow.", "Please urgently call the customer."]) { try { console.log(JSON.stringify({body,accepted:renderNudgeTemplate({purpose:"review_context",template_key:"review_context",template_version:1,repName:"Alex",customerName:null,customerNumber:"+12025550101",reasons:[],lastContact:null,source:null,recordUrl:"https://example.test",ownerId:"owner",customerNumbers:["+12025550101"],body})})); } catch(e) {console.log(JSON.stringify({body,error:e.message}));} }'
```

Actual output:

```json
{"body":"Please call the customer.","error":"NUDGE_NOT_ACTIONABLE"}
{"body":"Alex, call the customer tomorrow.","accepted":"Alex, call the customer tomorrow."}
{"body":"Please urgently call the customer.","accepted":"Please urgently call the customer."}
```

An initial reproduction invocation encountered an ESM/CommonJS import mismatch; the corrected CommonJS invocation above succeeded. Existing unit/route tests passing does not resolve the demonstrated coverage gap. No credentials, `.env`, live provider calls, production operations, source edits, branch changes, commits or pushes occurred in the review.

## Next feature issue

**CSI-17** is ready by its declared CSI-01 dependency and unlocks CSI-13 alongside the implemented CSI-06/10/12 services. CSI-07 is a separate ready live/dashboard track. CSI-14 still needs this correction, Team E dialogs/CSI-08 integration, and separately authorized live proof; none are implied complete by this recommendation.

Start with `10-intelligence-agent-contract.md`, routes §6, pipeline §14, Team D scope and frozen CSI-01 auth/envelope/evidence primitives. In MCP, inspect current repository state and use a dedicated `/api/intelligence-mcp` registration instead of exposing the broad existing tools. The complete copy-ready prompt is [NEXT-ISSUE-CSI-17.md](NEXT-ISSUE-CSI-17.md).

Main-server run auth is already implemented in `src/services/salesIntelligence/auth.ts`; CSI-17 must extend and consume it. Scope the next issue to bounded captured reads, versioned prompt/schema and immutable idempotent submission; leave AI execution/application, dashboard work and production credential rollout outside it.
