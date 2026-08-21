# Contradictions

Standing list. When code, a Service doc, `CONTEXT.md`, an ADR, and the Granot FINAL SPEC disagree, **stop and record**. Do not silently merge.

Format:

```markdown
## <id> | open|closed | <utc>
- sources:
- conflict:
- action: leave|flag-domain-modeling|sentence-fix-in-doc
```

## Open

## ops-registry-authoritative-plan-absent | open | 2026-08-21T0220Z
- sources: `docs/knowledge/services/operations-registry.md` header `Authoritative plan`; expected `docs/current_plans/01-operations-registry-specification.md`
- conflict: The Service still links that plan. The file is not in this checkout (same as before the move). Relative link was rewritten for the new depth only.
- action: leave — do not invent a copy.

## adr-skipped-absent | open | 2026-08-21T0217Z
- sources: `../docs/adr/0001-mongodb-system-of-record.md`, `../docs/adr/0002-granot-crm-post-despite-downstream-failures.md`, `../docs/adr/0003-lead-id-granot-leadno-ref-no-contract.md`; this standalone `vantage-main-server` checkout
- conflict: Conversion Pass 1 could not stamp those three ADRs. They are not present here (`optional_checkout`). Optimization unit `opt-f` must not invent copies. Record a GitHub path if MCP finds them in another Vantage repo.
- action: leave — do not invent copies. Stamp only if a later checkout includes `../docs/adr/`. Index lists the workspace paths.

## Closed

none
