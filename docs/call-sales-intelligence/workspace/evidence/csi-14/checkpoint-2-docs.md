# Docs keeper — CSI-14 nudge repair

## 1. Target

- Final cleanup: Team Messaging repair rejects a returned Direct-chat ID that differs from the persisted requested chat ID.
- Repo touched: `vantage-main-server`.

## 2. Layer decision

| Path | Matched rule | Layer | Action |
| --- | --- | --- | --- |
| `docs/knowledge/services/sales-intelligence-nudges.md` | Documentation maintenance | Service | Updated |
| `.cursor/rules/project-organization.mdc` | Always-apply organization map | Software logic | Skipped |
| `docs/index.md` | Catalog | Catalog | Skipped |

## 3. Changes made

- `docs/knowledge/services/sales-intelligence-nudges.md` — documented that Team Messaging receipt repair requires the returned Direct-chat ID, membership, sender, and message ID to match the persisted requested scope.

## 4. Skipped on purpose

- `docs/index.md`: no Service file was added or moved.
- `project-organization.mdc`: no ownership, route, cron, or configuration boundary changed.
- CSI-14 API contract already states that repair needs an exact message ID and scoped receipt.

## 5. Contradictions

- `docs/call-sales-intelligence/03-server-pipeline-and-jobs.md` still describes Team Messaging repair as listing chat posts since `createdAt`; current code retrieves the exact post and Direct chat by persisted IDs. Left unchanged because it is a locked sales-intelligence contract.

## 6. Follow-up

- Reconcile the locked pipeline contract through its owning contract process.