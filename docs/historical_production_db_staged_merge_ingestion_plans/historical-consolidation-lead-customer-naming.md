# Lead and Customer naming strategy

Status: accepted recommendation for historical consolidation  
Document set: historical production database staged merge ingestion  
Companion to:

- [historical-database-consolidation-plan.md](./historical-database-consolidation-plan.md)
- [historical-consolidation-rules-and-staging-spec.md](./historical-consolidation-rules-and-staging-spec.md)
- [historical-consolidation-next-analysis-handoff.md](./historical-consolidation-next-analysis-handoff.md)

## Problem

Source sheets often store compound person labels such as:

```text
Dave Ryan / Jason Marks
Dave Ryan \ Jason Marks
```

These appear in Customer Name (and related lead-display) cells. The temptation is to treat each segment as a separate Lead name or Customer. That is the wrong default for this migration.

## Strategy

| Concept | Cardinality | Rule |
|---|---|---|
| Lead name | 1 | One inquiry → one name. Do not store `lead_names[]`. |
| Customer on a booking | 1 | One primary `BookedLead.customer`. Do not add `customers[]` for this migration. |
| Agents | N | Already supported via `agent_allocations[]`. Split Agent labels on `/` only. |
| Raw compound text | provenance | Always preserve the original source string. |

### Lead name

A Lead is one inquiry event. Compound punctuation does not mean two leads.

1. Keep the raw source value in staging provenance.
2. Set the canonical lead/display name to **one primary** name.
3. Primary selection is deterministic: first non-empty segment after `/` or `\`, unless a reviewed decision overrides it.
4. Optionally flag the row as multi-name display for review/search. That flag is not a second identity.

### Customer / BookedLead

Keep the existing singular shape:

```text
BookedLead.customer       -> optional primary Customer reference
BookedLead.customer_name  -> source-preserving Customer/household display name
```

For name-only historical bookings, create or reuse a migration Customer with Job-Number-scoped identity. Do **not** globally merge Customers by name alone.

Do **not** auto-split `/`, `\`, `&`, or similar Customer text into multiple Customer records. The sheet has one Customer Name cell and no party roles, separate contacts, ownership shares, or per-party identifiers. Punctuation alone cannot distinguish:

1. Spouses / household label for one customer
2. Alternate or joint display names for one party
3. Agent names leaked into the Customer column
4. Duplicate or resubmitted booking text
5. Names that merely contain punctuation

Those cases become review evidence when suspicious, not automatic entity creation.

## Why not `customers[]` now

- Audit evidence shows many multi-name Customer cells, but no multi-party schema in the source.
- Production booking, cancellation mirror, Customer reverse virtuals, search, export, Sheet projections, and analytics all assume one Customer.
- A dual `customer` + `customers[]` design creates two writable authorities without enough domain evidence to define sync rules.
- Paying that complexity for ambiguous slash-separated labels would create false Customers and noisy merges.

## When multi-party Customers become worth it

Treat multi-party support as a **separate product decision**, not part of historical consolidation. Revisit only when operations have real per-party identity, for example:

- distinct phone or email per person
- explicit roles (payer vs mover, primary vs secondary contact)
- stable party identifiers from a future source system

Preferred future shape if that need becomes real:

```text
customer   -> required primary (backward compatible)
parties[]  -> optional { customer, role }
```

Never invent party rows from punctuation during historical import. If a human later confirms two real customers for a booking, resolve it through the conflict/decision artifact and replay that decision into the manifest.

## Conflict handling

Emit review cases when:

- a Customer segment exactly matches a known Agent but the full Customer value does not match accepted lead/contact evidence
- the Customer value conflicts with a non-empty production Customer name
- duplicate booking rows for one Job Number have incompatible Customer display values
- a matched lead has materially different contact identity and neither value is empty

Never silently choose among ambiguous customer interpretations.

## Bottom line

Pick one lead name. Link one Customer. Preserve compound source text as display/provenance. Split Agents, not Customers. Add multi-party Customer modeling only when independent party evidence exists.
