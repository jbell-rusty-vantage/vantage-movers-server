# Owner workflow interview — September 17, 2026

Status: interview completed for this specification revision. Accepted decisions are incorporated into revised 01–06 and 10; implementation workspace created under workspace/. This file preserves decision history, including statements that were refined later in the interview. 01–06/10 are the build contract; 08 remains historical context.

## Requested outcome

Complete the Owner interview, update the specification pack consistently, and create an implementation workspace inside this call-sales-intelligence folder for the Owner's agent teams. Runtime implementation has not been requested. Interview one question at a time with a recommendation.

## Accepted decisions

1. Keep the seven existing outreach Attention categories. Add a visible **Needs review** group alongside them for identity problems, unclear next steps, and possible missing Bookings, showing the specific reason on each item.
2. The Owner can confirm or reject Number↔Lead attachments within Sales Intelligence. Official Lead and Booking changes open the existing Vantage workflows with relevant context. A transcript Booking claim does not create a Booking.
3. Assignment remains with the selected Sales Rep (Agent) until the Owner changes it. Later calls preserve who handled them without changing responsibility. Assignment applies to the Outreach Record and its follow-ups; it does not change the Lead's receiver Agent or Booking allocations.
4. **Mark as worked** may stand alone, with an optional note. It does not imply customer contact or completion. Without a next step, the item appears under **Being worked, but no next step**.
5. An Owner-set callback date or next step takes precedence over subsequent AI analysis until completed, cancelled, or explicitly replaced by the Owner. AI may create follow-ups automatically where there is no Owner override. Conflicting subsequent analysis is visible under Needs review instead of silently replacing the Owner's instruction.
6. Preserve provenance of the Owner instruction, including who set it, when, and what it replaced, and preserve subsequent AI analysis and its evidence. Show **Agrees**, **Disagrees**, or **Cannot determine** against the particular Owner instruction. Model silence does not imply agreement. The Owner explicitly required provenance and model agreement/non-agreement.
7. Owner corrections take effect immediately, before re-analysis finishes. A corrected date updates the associated follow-up immediately; retracting a promise cancels the associated follow-up. Preserve the original assertion and correction history. Re-analysis updates the summary and agreement assessment without overriding the Owner.
8. Owner closure persists until the Owner reopens the work. Later missed inbound calls or explicit callback requests surface under **Needs review**. Routine later activity remains on the timeline without reopening the work.
9. An attributable callback attempt fulfills a promise simply to call, even when it reaches voicemail or gets no answer. Clear that specific overdue promise and record the actual outcome explicitly (No answer, Left voicemail, or Spoke with customer); an attempt never implies successful customer contact. Outreach remains open and, without another next step, appears under **Being worked, but no next step**. Precise descriptions of what actually happened are required throughout the interface.
10. AI may set **Waiting on Customer** for a clear customer commitment with a resolvable time and no conflicting Owner instruction. The Owner emphasized **very clear cases**. Unclear commitments such as “I'll call sometime” go to Needs review instead of creating an indefinite wait.
11. A clear day-only customer promise such as “I'll call you Friday” waits through that day's configured sales hours. Preserve the spoken wording and label the cutoff as a system default, not a customer-specified hour. If no call arrives, return the work to Attention when sales hours next open.
12. If the customer calls back but nobody answers, end Waiting on Customer and surface **Missed call—callback needed**. The customer fulfilled their promise to call; responsibility returns to Vantage. Preserve the assigned rep and show the actual missed-call outcome. This transition applies to waiting work and does not override the Owner-closure rule above.

## Explicit instructions carried into this interview

### Additional accepted decisions and architecture direction

- An attributable inbound human conversation with a Sales Rep counts as worked for a Form Lead and clears No call yet after form submission. Show who spoke and the actual direction. This supersedes the outbound-only transition in 01 §§5–7. An unanswered inbound still requires callback.
- Recorded calls matched to a Form Lead qualify for transcription and analysis regardless of duration. The same applies to Call Leads and Owner-opened Number Reviews, inbound or outbound. The 120-second Call Qualification rule for creating a Call Lead remains unchanged.
- Ambiguous identity permits conversation analysis but blocks Lead-specific follow-ups until resolved.
- Analysis continues on closed work and Booked or Cancelled Leads. New requests may surface for review; AI cannot reopen the work or mutate official Booking/Cancellation records.
- Missing recordings or unavailable analysis do not block deterministic outreach tracking from call history and Vantage events. Show missing/pending evidence explicitly. Provider-connected alone does not establish a human conversation.
- Owner architecture direction: use a Vercel AI SDK agent connected to the custom Vantage MCP server for LLM work, with tools to search Leads, Bookings, and gather other relevant context, plus call/output tooling and prompts. A filesystem sandbox agent/Eve is not required for this intended workflow. This replaces 08's proposed tool-free extraction design. Deterministic event processing remains distinct from LLM reasoning. Tool permissions and output-application boundary were subsequently accepted below.
- Inspection: main server already depends on `ai` (^7.0.68); installed docs describe ToolLoopAgent, structured output, HTTP MCP tools, and experimental MCP prompt retrieval. Current MCP tool registration includes Lead tools, health, and read-only Mongo tools. Dedicated Booking and call-intelligence tools/prompts require expansion; do not claim they already exist.

- AI assertions, summary, and structured outputs should execute without a prior human review gate. The Owner can review and correct them afterward.
- Perfect transcript-location verification must not block the initial feature. Exact verification robustness is a later Owner decision. Citation representation and first-release validation details still need resolution; do not silently inherit the previous citation gate.
- Owner actions to cover: callback due dates; confirming or requesting review of AI analysis using transcript and data; next step; Sales Rep assignment with backfilled RingCentral connections; messaging a rep; mark as worked; close; viewing connected records; add note.

## Additional accepted agent decisions

1. Use the Vercel AI SDK agent with Vantage MCP context-reading tools and one narrowly defined **Submit intelligence analysis** tool. The server automatically applies permitted effects and enforces Owner precedence. The agent does not receive direct official Lead/Booking mutation tools or rep-message tools for this workflow. This resolves the tool-permission decision previously marked open above.
2. Preserve the exact transcript version, retrieved Vantage context, prompt version, and model output for every run. Support re-analysis of original evidence with an Owner correction, or a new analysis using current Vantage context.
3. A clear rep callback promise creates a callback automatically even when Outreach is unassigned. When the speaker reliably maps to an Agent, make that Agent responsible for the callback and use them as the Outreach owner if unassigned. Preserve existing Owner assignment. Uncertain identity leaves the callback unassigned and visible under Open work nobody owns. The cross-rep case was explicitly resolved in the final accepted decisions below.
4. For the first release, the model's own recommended next step does not become an active follow-up automatically. Clear commitments from the conversation can auto-apply. Model recommendations are shown separately for the Owner to apply, with provenance distinguishing inference from a spoken promise or request.
5. One Outreach Record supports multiple active follow-ups, each with its own due date, responsible Agent, and outcome. Display the most urgent prominently and keep others visible. A later promise replaces an earlier commitment only when it clearly reschedules that same action; preserve history.
6. Track commitments such as sending an estimate or checking availability even if Vantage cannot directly observe completion. Preserve an action description and due date when established. An unrelated call must not clear them.
7. Clear confirmation in a later conversation can automatically complete the matching follow-up when it unambiguously identifies the same action and no Owner correction conflicts. Preserve the supporting conversation and describe the basis (for example, Completed based on customer confirmation). A new promise to act is not completion.
8. Clear commitments without a deadline are stored as undated follow-ups, with the responsible Agent when known, and appear in Needs review as Due date needed. Do not invent a deadline or mark them overdue. This requires revising the existing required due_at schema.
9. A clear customer callback request may automatically create due work even without the rep explicitly agreeing. Label it Customer-requested callback and preserve its origin. It is not a rep-promised callback unless the rep committed. The final Attention rules must retain this distinction.

## Further accepted behavior

1. Recorded inbound calls to mapped RingCentral sales numbers qualify for analysis even without a matching Lead or Owner-opened Number Review, regardless of duration. Analysis never creates a Lead or bypasses Call Qualification.
2. Clear sales-related callback requests or rep commitments from that analysis may automatically open a Number Review and create a follow-up when the number is eligible for contact. Never automatically reopen Owner-closed work; surface new requests under Needs review instead.
3. A clear customer contact restriction immediately pauses affected call actions and creates an Owner review item. Preserve evidence, wording, and scope. A time-limited restriction is temporary; a call restriction does not automatically prohibit texting. This supersedes the earlier handoff's proposed ban on all automatic contact-eligibility changes. Exact restriction storage and precedence must be reconciled in the final contract.
4. The envelope covers full sales context: move details, quoted prices, objections, customer intent, competitor mentions, and Booking/payment claims, as typed assertions with evidence. Distinguish said on the call, confirmed by Vantage records, and model inference. These assertions never rewrite official records.
5. Owner can confirm the entire current call analysis or individual assertions, and correct individual assertions and associated effects. Preserve prior confirmations in history. Newly generated assertions never automatically inherit Owner confirmation on re-analysis.
6. New Form Leads appear immediately in Attention. First-call deadline defaults to 30 staffed minutes, configurable by the Owner. After-hours arrivals start that clock when configured sales hours open; show overdue after the deadline.
7. Going cold defaults to two sales days without a human conversation, measured from Lead arrival if no conversation has occurred, configurable by the Owner. Unanswered attempts, voicemail, and delivered automated texts do not reset the clock. A future agreed follow-up or active Waiting on Customer period excludes the item from Going cold until the commitment becomes due.
8. Missed inbound calls appear immediately in Attention with a configurable default callback deadline of 15 staffed minutes. Repeated missed calls preserve the original deadline instead of extending it.
9. Each Attention item appears once under its highest-priority matching category, showing all other applicable reasons on that same item. Needs review remains visible alongside these reasons. Unresolved identity or contact restrictions that block calling must be explicit; do not suggest a call while blocked.
10. Sales hours default to Monday–Saturday, 08:00–20:00 America/New_York, editable in Coverage. They govern staffed deadlines and Going cold.
11. Voicemail recordings receive full analysis. Preserve whether the customer or rep left the message; never count voicemail as a live conversation. Supersedes the old pipeline's voicemail extraction skip.
12. New calls and relevant Vantage changes automatically refresh the number's overall analysis, including Booking context and resolved Lead attachments. Reuse existing transcripts, gather changed context, and update affected assertions and summary. Preserve prior versions and Owner corrections. Routine record updates with no relevant change do not trigger another AI run.
13. Historical backfill checks subsequent activity before creating active work from old promises. Fulfilled, replaced, or closed commitments remain historical. Still surface unresolved historical commitments with original dates and evidence.
14. Owner notes are attributed timeline context for future analysis. Adding a note alone does not mutate assignments, deadlines, or work status; explicit Owner actions perform those changes.
15. If work is unassigned, the first reliably identified Sales Rep in a human conversation becomes responsible even without a callback promise, when there is one clear rep. Label provenance Assigned from first conversation. Transfers or multiple reps with unclear responsibility leave work unassigned for review. Later calls never replace an existing assignment.
16. Outbound recordings by reviewed Sales Reps qualify for analysis even without a Lead or Number Review, excluding internal/company calls and numbers already classified as non-customer. Clear sales commitments may open a Number Review under the accepted rules.
17. Explicit callback times take precedence over configured sales hours, including a promise outside those hours. Preserve the explicit time and show any timezone assumption. Sales hours govern default deadlines and day-only interpretations.
18. AI may recommend closure for a clear decline, booked-elsewhere statement, or non-sales conversation, with reason and evidence under Needs review. The Owner performs Close; AI does not silently remove work from Attention. Official Booking, Cancellation, and Lead eligibility changes retain deterministic closure rules.

## Final accepted decisions and incorporation

- Owner raised the initial monthly AI budget to **$80**, editable in Coverage. Budget exhaustion retains queued analysis; operations continue.
- If Alex owns Outreach and Jordan promises a callback, Jordan owns that particular callback while Alex remains overall owner, unless the Owner explicitly assigned that callback otherwise. Preserve all three labels and their provenance.
- Specification revision completed in 01–06 and 10, including the event/queue/worker protocol, expanded analysis eligibility, automatic effects and Owner intervention.
- The workspace contains six team briefs, contract handoffs, dependencies, an unclaimed implementation ledger and acceptance scenarios. No runtime implementation, live provider action, or deployment was performed.
- Remaining items are implementation/deployment checks (recording grants, subscriptions, actual rep mappings, credentials, model capacity/pricing and rollout), not unanswered questions about the accepted Owner behavior. Retained engineering defaults are explicitly labelled in 06.

## Later Owner decision — September 19, 2026

The Owner (and the implementing developer acting as Owner) may send an Owner Rep Nudge to any current User extension on the stored directory snapshot for that RingCentral account. They know who to message. A reviewed Agent match is not required to send. This supersedes the earlier “reviewed link required before any rep nudge” rule in 01. Attribution, metrics, automatic assignment, and reviewed-rep outbound analysis still require reviewed identity. Never automatic. Never the customer. Incorporated into revised 01–05.

## Source access

Read the current specification, domain models, and 08 handoff for this interview. The supplied showcase editor URL could not be retrieved with the web reader; no claim of inspecting its contents has been made.
