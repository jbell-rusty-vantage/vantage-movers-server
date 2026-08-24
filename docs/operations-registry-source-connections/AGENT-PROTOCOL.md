# Agent protocol for this pack

Read this once before touching a pass. It is short on purpose.

## 1. Pick up a pass

1. Open [`PROGRESS.md`](PROGRESS.md). Take a pass whose status is `ready`.
   Never start a `blocked` pass — its prerequisite's contract is what you would
   be guessing at.
2. Set its status to `active`, add your start entry to the pass log, and say
   which repositories and branch you are on. Do this **before** the first edit,
   so a second agent does not pick up the same pass.
3. Open the pass issue and read §1 (authorities) and §4 (current-state evidence)
   in full.
4. **Reverify §4 against the repository before writing code.** It was observed
   on 2026-08-24. Anything that has drifted, you correct in the issue in the
   same commit as your work — a stale issue is how the next pass goes wrong.

## 2. Work the pass

- The specification wins on every conflict. If the issue and the specification
  disagree, follow the specification and fix the issue.
- Scope is §6 (deliverables) bounded by §7 (out of scope). Do not widen. If you
  find real work that belongs to another pass, write it into that pass's issue
  and into the **Cross-pass findings** table in `PROGRESS.md` — do not do it.
- If you are blocked, set the status to `blocked`, record the exact question in
  the pass log, and stop. A blocked pass with a precise question is a good
  outcome; a pass that guessed is not.

## 3. Close a pass

A pass is `complete` only when every box in its §10 acceptance criteria is
checked with evidence and every command in its §11 has been run and its output
recorded.

1. Write `reports/ORS-<n>-completion.md` covering the pass's §14 handoff list.
2. Update `PROGRESS.md`:
   - status → `complete`;
   - tick the pass's rows in the **Specification coverage** table;
   - move any pass it unblocks from `blocked` to `ready`;
   - append the closing entry to the pass log.
3. State plainly in the report what you did **not** do, and why.

## 4. Rules that override convenience

- **Never mark a criterion checked because it looks right.** Check it because
  you ran something and saw the result. Paste the result.
- **Never report a pass complete with a failing or skipped test.** Report it
  incomplete and say which criterion failed. Partial truth here compounds
  across four passes into a pack that claims a working Owner surface over a
  broken resolver.
- **Never delete a compatibility path in these four passes.** Instrument it.
  Removal is gated on the observation window; see the README.
- **Never enable SMS, apply a production index, deploy to production, read a
  live payload, or send anything external.** No pass in this pack authorizes it.
- **`PROGRESS.md` is a ledger, not an authority.** If it disagrees with the
  repository, the repository is right and you fix the ledger.

## 5. Language rule (applies to code, DTOs, and copy)

Database terms stay `source_company` / `source_granularity`. Owner-facing
surfaces say **Lead source** and **Feed**. Never write "Granot label"
unqualified: it is **What Vantage sends to Granot**
(`LeadSourceGranularity.crm_label`) or **Name received from Granot**
(`GranotCrmSource.granot_label`). Specification §7.6 is the full deck and ORS-4
turns it into a test.
