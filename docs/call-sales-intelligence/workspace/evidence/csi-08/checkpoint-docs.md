# Docs keeper — CSI-14 nudge observability

## 1. Target

- Examined final cleanup changes in `nudges/commands.ts` and its regression test.
- Repo touched: `vantage-main-server`.

## 2. Layer decision

| Path | Matched glob / rule | Layer | Action |
| --- | --- | --- | --- |
| `src/services/salesIntelligence/nudges/commands.ts` | `schema-and-crud-inputs.mdc` | CSI-14 Service | update |
| `src/services/salesIntelligence/nudges/nudges.test.ts` | `testing.mdc` | Convention | skip |

## 3. Changes made

- [sales-intelligence-nudges.md](C:/Users/Pinda/Proyectos/vantage/vantage-main-server/.git/vantage-quality/runs/1789816163516-89bcb4b3/workspace/docs/knowledge/services/sales-intelligence-nudges.md:29) now records that a customer-destination rejection precedes `OwnerRepNudge` persistence and emits `sales_intelligence.nudge.destination_rejected` against the `OutreachRecord`, with `outreach_record_id`.

## 4. Skipped on purpose

- `docs/index.md` is accurate; the existing CSI-14 catalog row remains sufficient.
- No rule update: this is a corrected event-entity fact, not a changed schema, route, configuration, or repository convention.
- Locked CSI contracts were not changed.

## 5. Contradictions

- none

## 6. Follow-up

- No documentation gaps remain. Focused test execution remains unavailable in this isolated checkout because `node_modules/tsx/index.js` is missing.