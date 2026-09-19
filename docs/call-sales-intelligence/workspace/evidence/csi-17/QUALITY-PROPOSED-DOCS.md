# Docs keeper — Sales Intelligence reevaluation

## 1. Target

- Final cleanup change to Rep Identity reevaluation and its related route ownership.
- Repo: `vantage-main-server`.

## 2. Layer decision

| Path | Matched rule | Layer | Action |
| --- | --- | --- | --- |
| `docs/knowledge/services/sales-intelligence-rep-identity.md` | `documentation-maintenance.mdc` | Service | Updated |
| `.cursor/rules/project-organization.mdc` | `project-organization.mdc` | Software map | Updated |
| `docs/index.md` | Catalog | Catalog | Skipped |

## 3. Changes made

- [sales-intelligence-rep-identity.md](C:/Users/Pinda/Proyectos/vantage/vantage-main-server/.git/vantage-quality/runs/1789786268819-98e1193c/workspace/docs/knowledge/services/sales-intelligence-rep-identity.md:21) now states that reevaluation schedules recording discovery for every scanned interaction, including those without recording entries, and that discovery owns the bounded retry window.
- [project-organization.mdc](C:/Users/Pinda/Proyectos/vantage/vantage-main-server/.git/vantage-quality/runs/1789786268819-98e1193c/workspace/.cursor/rules/project-organization.mdc:86) now maps CSI service ownership and the Owner/internal/cron route boundaries without duplicating service invariants.

## 4. Skipped on purpose

- `docs/index.md` already catalogs all affected CSI Service documents accurately.
- Locked CSI contract files were not rewritten.

## 5. Contradictions

- None found.

## 6. Follow-up

- None.