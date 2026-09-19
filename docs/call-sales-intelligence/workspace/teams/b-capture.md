# Team B — capture, Number Activity and recordings

Own CSI-02/03/04/11/12. Start after A's contracts. Read [01 §§6–7](../../01-specification.md), [03](../../03-server-pipeline-and-jobs.md), [02](../../02-domain-models.md), [RingCentral capability](../RINGCENTRAL-CAPABILITY.md), the RingCentral Call Qualification and Lead Conversation Service docs from the repository catalog.

## Deliver

1. All-direction webhook projection and authoritative Detailed Call Log reconcile with separate cursor/lease, canonical identity/aliases, no terminal-state regression and durable downstream jobs. Preserve qualified-call behavior byte-for-byte where possible.
2. Directory snapshots, unlinked Contact Numbers, activity/search/timeline and projection rebuild. Supply effective-time participant evidence to C/D; mapping review belongs to C.
3. Recording discovery with delayed availability, bounded private media fetch and explicit denied/throttled/absent states. Eligibility uses the accepted context cases with no duration cutoff and full voicemail processing.
4. STT/redaction and immutable transcript version/speaker uncertainty. Stage-specific retry never repeats successful expensive stages. Supply analysis-ready evidence and enqueue D's run job.
5. Capture and history feeds remain operational with no audio/AI. Expose honest complete-through/gaps and pagination. Backfill/retention integration belongs to F using these primitives.

## File ownership

Main-server `src/services/numberActivity/**`, intelligence `conversations/discover.ts`, `media.ts`, `transcribe.ts`, relevant RingCentral read adapters, capture/recording tests. Coordinate existing webhook route and shared cron registration through A; do not alter qualified-ingest services. C owns attachment and Outreach transitions; D owns analysis.

## Proof and handoff

Replay duplicates/out-of-order/transfer/fan-out/internal/withheld fixtures. Verify Call Log page failure never advances completeness incorrectly and original qualified cursor is unchanged. Test delayed recording 404 versus definitive absence, permission/throttle recovery, redaction before persistence, short call and voicemail eligibility. Handoff interaction/transcript fixtures and read contracts to C/D/E. Do not claim current production permission from September 14 probes.

## Kickoff prompt

> Implement Team B's CSI-02/03/04/11/12 using the frozen contracts. Keep Call Qualification and its cursor untouched. Deliver durable all-direction Number Activity and any-duration eligible recording/STT processing, including voicemail, with honest coverage. Integrate Team C's identity/rep inputs and hand versioned redacted transcript evidence to D. Record tests and limitations; do not create production subscriptions or backfills without task authorization.

## September 17 codebase alignment

[Audit and required adaptations](../../11-codebase-alignment-audit.md) are part of this delivery contract. Complete the rows assigned to this team and provide integration evidence; current runtime helpers do not already satisfy the revised contracts. [Design intake](../../07-claude-design-brief.md) governs the received design export; the September 19 sprint revision records adaptation and validation still required.
