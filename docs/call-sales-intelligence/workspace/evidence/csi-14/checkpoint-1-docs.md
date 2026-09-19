# Docs keeper — CSI maintenance

## 1. Target

- CSI routes, cron/queue dispatch, configuration, Number Activity read composition.
- Repo touched: `vantage-main-server`.

## 2. Layer decision

| Path | Layer | Action |
| --- | --- | --- |
| `docs/knowledge/services/number-activity-reads.md` | Service | Updated |
| `.cursor/rules/project-organization.mdc` | Organization rule | Updated |
| `docs/index.md` | Catalog | Updated |

## 3. Changes made

- Number Activity doc now reflects composed Outreach/restriction/review DTOs and default Outreach/nudge timeline events.
- Organization map now covers CSI admin routes, durable-job cron/queue wake-ups, and CSI config ownership.
- Index no longer incorrectly says CSI runtime work is unclaimed; Service docs are the status source.

## 4. Skipped on purpose

- Existing CSI attachment, outreach, nudge, rep-identity, transcription, foundation, and Lead Conversation Service docs already describe the shipped behavior.
- Locked CSI contracts and coordination ledgers were not edited.

## 5. Contradictions

- `src/services/numberActivity/contactNumbers.ts` still has a stale comment saying Outreach/restriction/review fields are empty until Team C. Runtime code now composes those fields. Not changed because this stage prohibits runtime-code edits.

## 6. Follow-up

- None.