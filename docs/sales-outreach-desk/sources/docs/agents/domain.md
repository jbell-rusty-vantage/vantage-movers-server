# Domain Docs

How the engineering skills should consume this workspace's domain documentation when exploring any Vantage codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the workspace root (`vantage/CONTEXT.md`) — platform-wide ubiquitous language shared by all codebases.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in. Cross-cutting decisions live at the workspace root (`vantage/docs/adr/`).

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill creates them lazily when terms or decisions actually get resolved.

## Layout

This workspace is a multi-repo folder (not a single git root). Platform vocabulary lives here at the workspace root. Codebase-specific terms, when they arise, will get their own `CONTEXT.md` inside the relevant repo — but shared terms always defer to the root glossary.

```
vantage/
├── CONTEXT.md              ← platform glossary (all repos)
├── docs/adr/               ← cross-cutting architectural decisions
├── vantage-main-server/
├── vantage-movers-clients/
├── vantage-admin/
└── granot_sync_extensions_and_services/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 — but worth reopening because…_
