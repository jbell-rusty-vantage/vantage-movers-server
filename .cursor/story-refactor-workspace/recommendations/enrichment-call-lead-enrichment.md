# Preview or Apply a Follow Up Row to an Existing Call Lead

- Target: `src/services/enrichment/callLeadEnrichment.service.ts`
- Evidence: `src/services/enrichment/callLeadEnrichment.service.ts`, `docs/knowledge/services/enrichment.md`

Keep preview and CSV sync as separate adapters of one match/diff operation, with per-row cards. Public `/call-leads/enrichment/sync` is shared lifecycle receipt apply and does not call this CSV writer; HTTP automation uses preview, then captures an approved receipt for apply. Do not combine those trust/transaction boundaries.

Resolve an exact typed Job Number first (newest-created five candidates). A compatible hit or source conflict is terminal for the Job lookup; a Granot phone matching another Lead must not steal it. Only missing/missed job falls through to phone: live normalized/raw operational phone plus ingested normalized phone, bounded to 25 and exact-digit rechecked in memory. Granot snapshot phone is excluded. Prefer unbooked/uncancelled pool if any, then source-compatible/unassigned, then recency by timestamp with createdAt fallback (not a secondary tie-break). Several compatible rows select newest plus warning; they are not automatically rejected as ambiguous. Keep job conflict warning/nonoverwrite and source conflict no-write behavior.

Preview never persists. It can report updateable for a contact-card difference even if there is no persistable field patch. CSV has no Observation, so `buildUpdate` never writes live name/email/phone or granot_contact_snapshot; contact changes are observation-only with warning until lifecycle apply. It also does not write move_date. Persistable changes are job (unless conflict), assignment, lane/state/local and cubic feet; repricing occurs only when local or source_company is in the actual update. Preserve unresolved-local retention.

Sync re-runs resolve/diff, applies a CRM username receiver only when absent, checks optional approved Lead/updatedAt/receiver identities, and rechecks them after opening its own transaction and reloading the Lead. Mismatches yield a failed row; valid supplied guards are accepted. Write only updateable/unchanged rows with a persistable patch or receiver change. Save Lead and source_lead/call_lead.enrichment.sync intent together; finalize after commit. A contact-only updateable row without receiver change stays nonpersisted. Per-row failures do not abort the rest of the batch.

Prove Job-wins against another Lead's phone, source-conflicting Job does not fall through, ingested-phone fallback versus Granot-phone exclusion, contact-only preview without save/intent, valid and stale guards, transaction rollback and postcommit finalization. Preserve status/result shape and receiver warnings, including booked-Lead refresh. Keep operation aliases during caller migration; avoid inventing a canonical Command or splitting preview and apply into separate ownership modules.


## Source-verified implementation constraints (2026-10-29)

The retained brief repeatedly required phone-first matching and contact diffs as persistable; live code is Job-first and CSV contact is observation-only. Drift options reject actual mismatches, not every supplied option.
