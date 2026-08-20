# Vantage OKF v0.2 frontmatter

Required field is `type`. Vantage also requires the fields below so Cloud jobs can search and map a diff to a concept.

## Service stamp

Map from the existing header. Do not rewrite the body.

| Existing header | OKF field |
| --- | --- |
| Filename (`form-lead.service.md`) | Path identity after move: `docs/knowledge/services/form-lead.md` |
| `# Form Lead Service` | `title` |
| First sentence of the body | `description` (one line) |
| `Primary code:` | `resource` (first/primary path) + `applies_to` + `sources[]` |
| `Domain terms used` | `tags` (kebab-case) + Markdown links to `CONTEXT.md` |
| Platform glossary / ADRs / FINAL SPEC | `sources[]` |
| — | `status: draft` on first stamp |
| — | `stale_after`: today + 90d (Service) or + 30d (integration) |
| — | `generated.by: process:okf-docs-conversion` |
| — | omit `verified` |

```yaml
---
type: Service
title: Form Lead Service
description: Create, update, and delete Form Leads, including duplicates, CRM Posting, and Sheet Sync tab routing.
tags: [form-lead, ingestion, crm-posting]
status: draft
stale_after: YYYY-MM-DD
resource: src/services/leads/formLead.service.ts
applies_to:
  - src/services/leads/formLead.service.ts
  - src/services/leads/leadIngestionProvenance.ts
  - src/services/crm/**
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/leads/formLead.service.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
  - id: adr-0001
    resource: ../docs/adr/0001-mongodb-system-of-record.md
  - id: adr-0002
    resource: ../docs/adr/0002-granot-crm-post-despite-downstream-failures.md
generated:
  by: process:okf-docs-conversion
  at: 2026-08-20T00:00:00Z
---
```

`resource` and `applies_to` are repo-relative from `vantage-main-server/`. `sources[].resource` that live outside this repo (`CONTEXT.md`, `docs/adr/`) stay workspace-relative as `../CONTEXT.md` and `../docs/adr/...`.

`generated.at` is the stamp time. Change it later only when the body meaningfully changes.

## Type vocabulary

Use only these `type` values:

| type | Use |
| --- | --- |
| `Service` | Migrated businesslogic files |
| `ADR` | `../docs/adr/0001`–`0003` |
| `Reference` | Granot spec hub only |
| `Playbook` | Existing runbooks if you must stamp one in place; do not relocate them |
| `Suggestion` | Forbidden during conversion |

Do not invent `Business Rule`, `Invariant`, or `Code Map` in this phase.

## Freshness

| Kind | `stale_after` |
| --- | --- |
| Integration Service (RingCentral, Granot HTTP collector, Google Sheets, enrichment) | today + 30 days |
| Other Service | today + 90 days |
| ADR / Reference hub | today + 180 days |

## Trust

- First stamp: `status: draft`, no `verified` key.
- Do not write `status: stable` until a human later reviews the stamp.
- Never fabricate `human:…` in `verified` or `generated`.
- A factual one-sentence fix during conversion updates `generated.at` and stays `draft`.

## Stub (old path after move)

```yaml
---
type: Service
title: Form Lead Service
description: Moved. Use the canonical Service document.
tags: [form-lead]
status: deprecated
resource: docs/knowledge/services/form-lead.md
generated:
  by: process:okf-docs-conversion
  at: 2026-08-20T00:00:00Z
---

Moved to [`docs/knowledge/services/form-lead.md`](../../docs/knowledge/services/form-lead.md).
```

Adjust the relative link to the real target. No invariants on the stub.

## Link rewrite after move

From `docs/knowledge/services/` or `docs/knowledge/granot-lifecycle/`:

| Target | New relative link |
| --- | --- |
| Workspace glossary | `[term](../../../../CONTEXT.md)` |
| Workspace ADR | `[ADR-0001](../../../../docs/adr/0001-mongodb-system-of-record.md)` |
| Sibling Service | `[Call Lead](./call-lead.md)` |
| Granot concept from services | `[capture](../granot-lifecycle/capture.md)` |
| Service from granot-lifecycle | `[Form Lead](../services/form-lead.md)` |
| Cursor rule | `[form-lead-granot-crm.mdc](../../../.cursor/rules/form-lead-granot-crm.mdc)` |
| Primary code (prose) | keep repo-relative `src/…` in backticks |

Keep the pre-existing **Platform glossary / Primary code / Domain terms** header under the YAML so humans still see it. Fix only broken relative paths.

## Index file

`docs/index.md` frontmatter:

```yaml
---
okf_version: "0.2"
title: Vantage main server knowledge
description: Type-grouped entrypoint for agent-readable concepts.
---
```

Group headings: Service, ADR, Reference, Archives. Archives are links only (ODV, showcase, historical plans) — those files stay unstamped.
