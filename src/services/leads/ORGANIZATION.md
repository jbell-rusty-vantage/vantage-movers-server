# Organizing the leads modules

Engineering note, 2026-10-29. This is not a Service document and it is not a story-refactor recommendation. The Form Lead and Call Lead story passes already landed the public names (`ingestFormLead`, `correctFormLead`, `removeFormLead`, and the Call Lead equivalents) and said not to split those files by create / read / update / delete. This note is the later question: the files are still too big, and a line cap is the wrong way to fix that.

Words used below: a **module** is a file with an interface and an implementation. A **seam** is the place callers use that interface. A module is **deep** when a lot of behavior sits behind a small interface, and **shallow** when the interface is almost as big as the body.

## File size is a signal, not a rule

Do not add a default maximum line count, and do not turn one on in the linter.

A cap treats length as the defect. Length is how a second responsibility becomes obvious. Enforcing a number produces shallow modules: one function per file, pass-through files, and callers that have to learn as much surface as they used to learn by reading one story. The quality gate's `maxLines` is a limit on the size of a change, not on the size of a file. Leave it that way.

Use this as a review habit instead:

- Under a few hundred lines, do not go looking for a split. `leadName.service.ts` (40), `leadCplResolution.ts` (86), and `leadLocation.service.ts` (139) are the right size because each one owns one decision.
- Around 400 to 600 lines, read the file and ask whether it has a second reason to change. A single workflow at that length can stay. `wordpressFormSubmissionReceipt.ts` (343) and `duplicateLead.service.ts` (298) should stay whole.
- Past that, split only when you can name two or more reasons the file changes, and each reason has its own caller-facing interface. `formLead.service.ts` (1,115) and `callLead.service.ts` (994) are in this bucket because each one holds ingestion, correction, and removal.

A 500-line file with one reason to change is healthier than five 100-line files that only exist to satisfy a counter.

## What is already organized

The shared decisions already have their own modules. Do not fold them back into the Form Lead or Call Lead files, and do not split them further.

| Module | Decision it owns |
|---|---|
| `duplicateLead.service.ts` | Duplicate Form Lead match, and Form Fill on Call Leads |
| `leadCplResolution.ts` | CPL snapshot at ingestion and on correction |
| `leadLocation.service.ts` | Move Type and required location |
| `leadName.service.ts` | Name normalization |
| `leadSourceCompany.ts` | Source Company and Source Granularity assignment |
| `leadIngestionProvenance.ts` | Ingestion Origin and No-Sync on create |
| `wordpressFormSubmissionReceipt.ts` | WordPress Form Submission Receipt reuse |
| `leadPhoneMatching.ts` | Phone match sieve |
| `sourceLeadLookup.service.ts` | Finding the lead attached to a Booking |
| `receiverAgentWrite.ts` | Receiver agent write |
| `index.ts` | Public barrel. Routes and `v1.service.ts` import this, not the individual files |

RingCentral duplicate classification stays in `src/services/ringcentral/ringcentral-duplicate-guard.ts`. It is a Call Lead rule with a 90-day window. It does not belong in `duplicateLead.service.ts`.

## Why these two files should split

`formLead.service.ts` is four stories in one file:

| Story | Rough lines | Reason it changes |
|---|---|---|
| Ingestion | 144–596 | Quote normalization, duplicate match, WordPress receipt reuse, save, then Granot, sheets, and messaging after commit |
| Correction | 598–870 | What a patch may change, reprice, receiver, and the attached Booking |
| Lookup | 872–894 | Recent list, and the enrichment read that hides a Duplicate Lead |
| Removal | 896–1047 | Booked cascade, sheet tombstone, delete |
| Old names | 1049–1115 | `createFormLead`, `updateFormLead`, `deleteFormLead`, and the transaction aliases |

`callLead.service.ts` is the same shape: Admin ingestion, RingCentral ingestion, correction, removal, and the same old names. The two files look alike and should be split the same way. They should not be merged. Form correction refuses quoted and cubic feet on a Duplicate Lead. Call correction refuses marking a Booked Call Lead as a duplicate. A shared "correct a lead" module would hide those rules behind one interface both sides have to special-case.

Correction and removal still call `deleteBookedLead` and `refreshAttachedBookingFromLead` on `v1.service.ts`. That import is temporary until booking extraction. Ingestion does not need it. A workflow split keeps that cycle in correction and removal only.

## Recommended shape

Keep the public barrel. Move each workflow behind the existing exported functions. Callers of `index.ts` do not change.

```
leads/
  index.ts                         # same exports
  formLead.service.ts              # lookup + old names; re-exports the three workflows
  formLeadIngestion.ts             # ingestFormLead, beginFormLeadIngestion, completeFormLeadIngestion
  formLeadCorrection.ts            # correctFormLead, persistTheCorrectionAndRefreshTheBookingChain
  formLeadRemoval.ts               # removeFormLead, beginFormLeadRemoval
  callLead.service.ts              # same role as the Form Lead facade, after the Form Lead split is proven
  callLeadIngestion.ts
  callLeadCorrection.ts
  callLeadRemoval.ts
  …shared modules above, unchanged
```

Stay flat in `leads/`. A `formLead/` folder pays off only if a workflow file itself grows a second reason to change. Three sibling files do not need a directory.

Inside a workflow file, keep the private steps private. `prepareTheQuoteForIngestion`, `normalizeTheCustomer`, `locateTheMove`, and `writeTheFormLead` are the implementation of ingestion. Giving each one a file would make the ingestion interface shallow. The seam callers use is `beginFormLeadIngestion` / `completeFormLeadIngestion`.

Leave lookup on the facade. It is about twenty lines. Its own file would be a shallow module. Leave the compatibility aliases on the facade too, until `v1.service.ts`, existing writes, and CSV sync call the story names. Then delete the aliases. Do not give them a module.

`formLead.service.test.ts` and `callLead.service.test.ts` keep importing the public functions. They are tests of the seam, not of the file layout. Split a test file only when a new module has a decision worth proving on its own, the way `duplicateLead.service.test.ts` already does.

## What not to do

- Do not split by create / read / update / delete. That was already rejected, and it cuts across one workflow (begin and complete are both "create").
- Do not extract a shared Form-and-Call correction or removal module in this pass.
- Do not move Form Fill or the Duplicate Form Lead query again. They already have a module.
- Do not move RingCentral duplicate classification into `leads/` to make the folder "complete."
- Do not split both lead types in one change. Form Lead first. Call Lead copies the shape only after the Form Lead exports and tests are unchanged.

## Order of work

1. Move Form Lead ingestion into `formLeadIngestion.ts`. `formLead.service.ts` re-exports the same functions. Run `formLead.service.test.ts`.
2. Move correction, then removal, the same way. After each move the public types (`FormLeadIngestionInProgress`, `FormLeadCreateTransactionResult`) stay exported from the facade, because `index.ts` and the tests already use them.
3. Update `docs/knowledge/services/form-lead.md` so its code paths list the new files. The behavior section does not change.
4. Repeat 1–3 for Call Lead and `docs/knowledge/services/call-lead.md`.

No behavior change belongs in this split. If a move tempts a rename, a reordered post-commit step, or a shared helper, stop and leave that for its own change.
