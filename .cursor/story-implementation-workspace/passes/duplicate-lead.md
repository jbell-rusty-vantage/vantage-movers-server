# Pass — Duplicate Lead

- Status: implemented
- Recommendation: `.cursor/story-refactor-workspace/recommendations/leads-duplicate-lead.md`
- Target: `src/services/leads/duplicateLead.service.ts`
- Branch: `refactor/form-lead-tests`
- Session: `impl-duplicate-lead-2026-10-29T2234Z`

## Story names

Kept. The live names already separate classification from Form Fill.

- `findDuplicateFormLeadMatch`
- `isDuplicateFormLead`
- `hasFormFillForCallLead`
- `markMatchingCallLeadsWithFormFill`

No aliases were added. Persisted `markCallLeadFormFill`, `form-fill-detector`, and `call_lead.form_fill.update` are unchanged. The granularity error string is unchanged.

## What changed

- Comments that said “same source company” now say exact Source Granularity for classification, and the source-scope filter for Form Fill.
- Outcome proofs in `duplicateLead.service.test.ts`: missing granularity throws only when contact exists; equal timestamp is `$lt`; cutoff cohorts; `matchedBy` email, phone, and both; Form Fill detect `$or`; Form Fill mark shares one `command_execution_id` and the caller session.
- `form-lead.md` and `call-lead.md` now describe the Form Lead read and the Call Lead flip as two queries.

## Left in place

- `buildPhoneRegex` in `leadPhoneMatching.ts`
- `normalizePhoneNumberForMatch` in `src/utils/phone.ts`
- Private cutoff and `buildSourceMatchFilter` in the duplicate-lead file
- Classify `find` stays unsessioned
- Parked `formLead.service.test.ts` was not edited

## Parity

- Targeted tests: `duplicateLead.service.test.ts` — 16 passed
- `tsc --noEmit` on this pass: `duplicateLead.service.test.ts` is clean after the session cast. The repo typecheck still fails in the parked Form Lead test and `ops/output/pool-active-canonical-audit.ts`.
- Review: [parity review](d2ee5f46-1013-49bf-993f-2beeb891f330). No parity findings.

Taste left unfixed: the mark test does not lock the phone-sieve `$or` or `save({ session })`. The knowledge sentences do not mention the 25-lead cap.
