# Handoff: Vantage historical consolidation — parsing, matching, and rule refinement

## Purpose of the next session

Perform one more analysis pass before implementation. Refine the existing
historical ingestion/consolidation plan around:

- Multi-name parsing and separator rules.
- Agent allocation splitting.
- Whether BookedLead must support multiple Customer references.
- Form-fill and duplicate classification timing.
- Precise name matching.
- Conflict artifacts and human/agent decision workflow.

Do not apply migrations or mutate production during this pass.

## Start here

The completed plan is the canonical summary; do not restate it:

- `C:\Users\Pinda\Proyectos\vantage\vantage-main-server\docs\historical_production_db_staged_merge_ingestion_plans\historical-database-consolidation-plan.md`

Aggregate reports:

- `C:\Users\Pinda\Proyectos\vantage\vantage-main-server\scripts\historical\reports\sheet-audit.md`
- `C:\Users\Pinda\Proyectos\vantage\vantage-main-server\scripts\historical\reports\sheet-audit.json`
- `C:\Users\Pinda\Proyectos\vantage\vantage-main-server\scripts\historical\reports\database-audit.md`
- `C:\Users\Pinda\Proyectos\vantage\vantage-main-server\scripts\historical\reports\database-audit.json`
- `C:\Users\Pinda\Proyectos\vantage\vantage-main-server\scripts\historical\reports\bad-leads-audit.md`
- `C:\Users\Pinda\Proyectos\vantage\vantage-main-server\scripts\historical\reports\bad-leads-audit.json`

Read-only audit scripts:

- `C:\Users\Pinda\Proyectos\vantage\vantage-main-server\scripts\historical\audit-consolidation-sheets.ts`
- `C:\Users\Pinda\Proyectos\vantage\vantage-main-server\scripts\historical\audit-consolidation-databases.ts`
- `C:\Users\Pinda\Proyectos\vantage\vantage-main-server\scripts\historical\audit-bad-leads-tabs.ts`

Package commands:

```text
pnpm historical:audit-sheets
pnpm historical:audit-databases
pnpm historical:audit-bad-leads
```

These scripts are read-only and produce aggregate reports without customer row
values.

## Important existing code

### Agent name splitting

Current helper:

- `C:\Users\Pinda\Proyectos\vantage\vantage-main-server\scripts\historical\historical-agent-allocation.ts`

Current behavior:

- `splitHistoricalAgentNames` splits only on `/`.
- It trims/collapses whitespace and removes duplicate normalized names.
- `splitBinderAmountEvenly` already divides cents deterministically and
  distributes remainder cents, so allocations always sum exactly to the binder
  total.

The next pass must profile actual separators before changing the parser:

- Forward slash `/`.
- Backslash `\` if present.
- Other possible separators (`&`, `+`, commas, words such as `and`) only if
  observed and unambiguous.
- Repeated separators and whitespace.
- Suffixes that may be metadata rather than names, such as `Split` or a
  terminal percentage.

Do not use broad punctuation splitting until the actual value inventory proves
it is safe.

### Current booking/customer shape

- `src/models/BookedLead.ts` has `agent_allocations[]` but only one
  `customer: ObjectId` and one `customer_name` string.
- `src/models/CancelledLead.ts` also has a singular customer link.
- `src/models/Customer.ts` reverse virtuals use `foreignField: "customer"`.
- Booking services, validation, sheet projections, analytics, search,
  cancellation mirroring, admin detail/export, and observability currently
  assume one customer.

The user suspects a source value such as `Dave / Jason` may represent multiple
customers and therefore may require a `customers[]` relationship on
BookedLead. Treat this as a hypothesis requiring evidence, not an approved
schema change.

Before proposing `customers[]`, distinguish:

1. Multiple actual customers/contract parties.
2. A compound display name for one household/customer record.
3. Agent names accidentally present in the customer column.
4. Duplicate/resubmitted booking rows.
5. Names containing punctuation that is not a separator.

If multiple customers are real, compare migration designs:

- Add `customers[]` while retaining singular `customer` as a backward-compatible
  primary-customer field.
- Replace singular `customer` (high migration cost; probably avoid).
- Introduce a booking-party/allocation subdocument if roles or shares matter.

Inventory every affected reader/writer before recommending a schema.

### Agent allocations

BookedLead already supports multiple agent allocations. Desired rule:

- A value representing three agents produces three canonical Agent references.
- Each gets one third of the total binder amount.
- Fractional cents use the existing deterministic remainder distribution.
- Allocation amounts must sum exactly to `total_binder_amount`.
- Preserve source order only as provenance; canonical identity is precise
  normalized Agent matching.
- Do not create variants caused by suffix metadata (`Split`, percentages) as
  new Agents without analysis.

Existing production Agent matches and aliases take precedence. Missing Agents
are created inactive. Never fuzzy-match Agent names.

## Form-fill and duplicate rules: question to resolve

Working hypothesis for the next pass:

- Stage and normalize all raw leads first.
- Resolve exact source identities and production overlap next.
- Apply `form_fill` and duplicate classification in a deterministic second
  pass ordered by authoritative sheet timestamp.

Reasons to test:

- Row-by-row classification is import-order dependent.
- A call's form-fill status requires the complete form-lead population.
- Production overlap must be collapsed before duplicate classification or the
  imported copy can cause a false duplicate.
- Historical classifications should use the same source scope and time-window
  semantics as runtime production rules, but must not trigger runtime CRM or
  Sheet side effects.
- Classification fields should not decide whether the raw source event is
  ingested; they annotate the canonical lead after identity resolution.

The next agent should trace and compare:

- `src/services/leads/duplicateLead.service.ts`
- `src/services/leads/callLead.service.ts`
- `src/services/leads/formLead.service.ts`
- Any current form-fill helper/matcher and its source/date scope.
- Historical sheet `Form Fill Checker` formulas/values versus Mongo semantics.

Output a rule table covering:

- Input population.
- Match keys.
- Time window.
- Source-company scope.
- Tie/ambiguity behavior.
- Whether the rule is authoritative or derived.
- When it runs in the staged pipeline.
- Whether rerunning can change a previous classification.

## Name and merchant matching requirements

Name matching must be precise.

- Exact normalized names and explicit aliases are allowed.
- Separator parsing must happen before name matching.
- Fuzzy matching must not automatically merge Agent, Customer, or catalog
  identities.
- Any fuzzy/customer similarity result is a candidate conflict, not a write.
- Preserve original display values in provenance.
- Customer matching must avoid global name-only merges.

Confirmed merchant rule:

```text
Elavon CC -> Elavon
```

The user believes this is the only special merchant alias. All other merchant
names should use exact normalized matching. If not present in production,
create an inactive Merchant rather than inferring another alias. Emit possible
semantic similarities only as review suggestions.

## Conflict workflow

The user wants major conflicts emitted for joint human/agent decisions.

Refine the plan to produce two artifacts:

1. Aggregate conflict report: counts by conflict kind, source, date window,
   and proposed disposition.
2. Record-level decision cases: stable case id, source provenance, competing
   candidates, relevant normalized fields, rule attempted, confidence/evidence,
   recommended options, and an explicit unresolved status.

Never silently choose among:

- Ambiguous lead identity matches.
- Multiple customer interpretations.
- Conflicting duplicate booking facts.
- Separator parsing with uncertain roles.
- Fuzzy name matches.
- Conflicting non-empty production/historical fields.

Define a machine-readable decision file so approved resolutions can be replayed
deterministically into a new manifest. Decisions must be separate from generated
evidence so regenerating reports does not overwrite them.

## Known facts to preserve

- No production or spreadsheet writes were made during the completed analysis.
- Best Relocation's 2026-07-24 apply/correction is completed history and must
  not be replayed.
- The consolidation plan requires an immutable manifest and two applies against
  a fresh `testvantagemovers`; the second apply must be a no-op.
- Pre-2026-04-30 records must not be synced back to Master Leads.
- Existing receiver agents are never overwritten; missing receiver attribution
  can use the canonical primary sales Agent after an accepted booking/lead link.
- Missing Agents, Merchants, and LeadSourceCompanies are created inactive.
- Bad_Leads colors are not a reliable reason taxonomy.
- The year-0205 Book Date has deterministic source evidence for 2025-07-20;
  see the database audit.

## Workspace safety

The server repository already contains unrelated uncommitted Google Drive OAuth
work and Operations Registry artifacts. Preserve all existing changes. Inspect
`git status` before editing and avoid overlapping unrelated files.

The local `.env` selects live `vantagemovers` and queued Sheet Sync. Do not run
write-capable historical ingest/reconciliation scripts as-is. Never print
secret values.

Repository-wide typecheck currently reports 17 unrelated baseline errors in
other operational scripts. The three new consolidation audit scripts have no
TypeScript diagnostics.

## Expected deliverables from the next pass

1. A data-driven separator inventory for customer and agent columns, with
   counts and examples redacted or represented by source row ids.
2. A precise tokenizer/parser specification with ambiguity rules.
3. A decision on BookedLead customer cardinality, including affected code
   surfaces and backward compatibility.
4. A deterministic agent allocation specification and tests.
5. A form-fill/duplicate timing and rule matrix.
6. Exact name/alias matching rules; no automatic fuzzy merge.
7. Conflict artifact schemas and review workflow.
8. An updated implementation plan/report referencing, not duplicating, the
   existing consolidation plan.
9. No production apply.

## Suggested skills

- `domain-modeling` — use if Customer, booking party, household, sales Agent,
  and receiver Agent terminology/cardinality needs to be made explicit.
- `codebase-design` — use to choose the BookedLead/customer compatibility seam
  and keep the parser/planner as a deep module.
- `grill-with-docs` — use if the user wants to resolve high-impact conflict and
  schema choices interactively while recording decisions.
- `tdd` — use when implementing separator parsing, exact matching, allocation
  arithmetic, and deterministic conflict classification.

