# Lifecycle assurance prototype

**Question:** Can the records already stored by Vantage answer, with named
confidence, whether a Lead was created, texted, updated, entered Booking or
Cancellation intake, became an official Booking or Cancellation, and requested
Sheet Sync? Where can the current data *not* prove completeness?

This is a read-only, throwaway prototype. It does not use `OperationalEvent` as
evidence and it creates no Mongo collections. It reads the system-of-record
collections, evaluates their joins, assembles masked Job Number timelines with
the existing prototype, and writes a Markdown proof plus a JSON Canvas.

## Run

```text
pnpm prototype:lifecycle-assurance
pnpm prototype:lifecycle-assurance -- --hours=24 --confirm-production-db=vantagemovers
pnpm prototype:lifecycle-assurance -- --from=2026-08-26T12:00:00Z --to=2026-08-27T12:00:00Z --confirm-production-db=vantagemovers
```

The default database is `testvantagemovers`. Production is refused unless the
exact confirmation flag is present. Output is written under
`scripts/output/lifecycle-assurance/`:

- `assurance-latest.md` — the main human-readable proof
- `assurance-latest.json` — the machine-readable evidence summary
- `assurance-latest.canvas` — visual evidence chain and confidence map

No contact, raw payload, Mongo ID, Sheet ID, or Job Number is emitted. Example
Jobs are labelled `Job A`, `Job B`, and so on.

