# Attention availability and stored analysis visibility — September 22, 2026

This narrow successor records the Owner-requested repair to keep Outreach Intelligence visible and expose already-generated call summaries and assertions. It supersedes only the expiry/read rules in `ATTENTION-PROJECTION.md` and the analysis-run list query in CSI-18 `CONTRACTS.md`. Those locked documents remain historical contracts; all other authorization, dataset, evidence, command and pagination rules remain unchanged.

## Attention availability

- A successful complete publication stores its header and chunks with `expires_at: null`. The existing Mongo TTL index ignores null dates.
- In the same transaction, older retained snapshots receive expiry five minutes after replacement. Failure leaves the last successful snapshot available. Snapshot contents and cursor identities remain immutable.
- Readers accept null expiry or a future dated expiry. No successful snapshot means `pending_projection`; a retained snapshot older than five minutes stays `ready` with optional `stale: true` and its original `as_of`.
- Admin shows the delayed-refresh notice and existing rows. Commands still validate current state. Operational checks must accept the same null-or-future predicate.
- Existing dated snapshots retain their expiry. Verify rollout by finding a complete header with null expiry after successful publication, then confirm the list stays visible beyond five minutes. No index migration is needed.
- Roll back by publishing a snapshot compatible with the old reader before returning to date-only reads. Waiting five minutes alone does not retire the latest retained snapshot.

## Completed conversation analysis discovery

`GET /analysis-runs` retains its existing parameters and adds optional `status=completed` and `conversation_only=true|false`. Other status values remain invalid. Completed filtering requires non-null output and excludes runs whose purge has started or completed. Conversation-only filtering selects runs with a conversation ID. Existing unfiltered callers preserve their history view.

The existing guarded run detail endpoint remains responsible for returning summaries and assertions. Admin's Running Summary panel lists completed conversation analyses separately, with pagination and links to full analysis/evidence. A call summary is not substituted for the separately synthesized Number running summary. Display does not rerun analysis or imply every assertion was applied to Outreach.

Server must deploy before Admin starts sending the new strict query parameters. Regression checks cover retained stale lists, cursor expiry, initial absence, and call-analysis visibility with and without a Number running summary.
