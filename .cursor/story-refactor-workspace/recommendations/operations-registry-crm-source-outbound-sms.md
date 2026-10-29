# Set a Granot name's confirmation-text policy and show masked recent messages

- Status: recommended; source-verified 2026-10-29.
- Target: `src/services/operationsRegistry/crmSourceOutboundSms.ts`
- Domain: `docs/knowledge/services/operations-registry.md`, `docs/knowledge/services/lead-messaging.md`.
- Callers: Registry outbound-SMS PATCH/recent GET in `src/routes/v1.routes.ts`, sibling Granot projections, and reviewed source-policy migrations.

## Current operation and useful seams

`setGranotCrmSourceOutboundSms` is an Owner policy command, not a sender. It checks Owner, trimmed 10–1000 character reason, ObjectId, nonempty template of at most 320 characters and only `{first_name}`/`{company}` placeholders before opening the Registry mutation. An enable request needs an attested consent basis, `lead_created_policy: create_if_missing` and an operationally enabled Granot name. Policy write and the `granot_crm_source_sms_policy` Change share `withRegistryMutation`; caches invalidate after commit. Sending remains a post-commit Lead Message operation.

Template changes increment the version and force stored texting off. Reverting consent to `not_attested` forces off; changing between two attested bases updates the attestation and does not itself force off. The Service's broader consent-change sentence is imprecise; do not implement it during a rename. A first custom template compares with the default template even if no policy was stored, so it counts as a change.

`daily_cap` is absent from `OutboundSmsCommand`, `OwnerOutboundSmsView` and the current HTTP schema. The writer copies the old stored numeric cap, defaulting to zero. It does not implement a day limiter. Preserve this storage compatibility without exposing it as an Owner safety control. `granotCrmSources.ts` already turns texting off in the same transaction when an enabled SMS policy leaves `create_if_missing`, with `lead_created_policy_changed_from_create_if_missing`; do not duplicate that invariant here.

`toSmsView` is the safe sibling-card adapter; it supplies off/default-template/version-one/not-attested defaults and omits the cap. `listRecentGranotCrmSourceSms` selects metadata without body, masks the destination, and clamps limit to 1–50. Its `sent_at` falls back to accepted/created time, so it is not necessarily proof of sending.

## Remaining naming and parity work

A useful story name for the command is `setGranotConfirmationTextPolicy`; recent-message reads and safe-view mapping remain separate boundaries. Keep existing export aliases until routes, sibling projections and migrations move. Do not create a policy class or move the sender, source semantics or actor verification here.

Audit action follows requested `command.enabled` (`activate` versus `update`), even when a template change leaves stored enabled false. Preserve that discrepancy during a rename. Validation uses `DEPENDENCY_CONFLICT` with explicit 400; missing source uses `NOT_FOUND`, non-Owner uses `FORBIDDEN`. Do not silently normalize those contracts.

Read `crmSourceOutboundSms.test.ts` before claiming existing coverage. Needed parity proof includes transactional write/audit order, cache invalidation only after commit, template-change and consent transitions, stored-cap pass-through with no cap in the returned view, inactive/non-creating source refusal, default-template first save, and masked recent rows with no body. The sibling policy-change SMS-off proof belongs on `granotCrmSources`; send gates belong on `granotCreatedLead`. This documentation review ran no tests.
