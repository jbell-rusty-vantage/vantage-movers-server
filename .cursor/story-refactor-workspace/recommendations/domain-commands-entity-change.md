# Record an Entity Change

- Status: reviewed starter, 2026-10-29
- Target: `src/services/domainCommands/entityChange.ts`
- Current declared exports (local declarations; re-exports are additional): `FORM_LEAD_CHANGE_PATHS`, `CALL_LEAD_CHANGE_PATHS`, `RECORD_LINK_CHANGE_PATHS`, `BOOKED_LEAD_CHANGE_PATHS`, `CANCELLED_LEAD_CHANGE_PATHS`, `PlannedAggregateMutation`, `AggregateMutationPlan`, `sourceSystemForOrigin`, `classifyEntityChangePath`, `buildEntityChangeFields`, `buildDeleteChangeFields`, `changedPathsFromFields`, `collectDocumentFieldChanges`, `persistEntityChangeMutations`.
- Evidence: `src/services/domainCommands/entityChange.ts`, `docs/knowledge/services/domain-commands.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `docs/knowledge/services/form-lead.md`, `src/services/granotLifecycle/callLeadFormSibling.ts`

## Recommendation

Consider renaming `persistEntityChangeMutations` to `appendThisEntityChange` if the live callers still benefit; keep `persistEntityChangeMutations` as an exact alias until callers migrate. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Preserve transaction boundaries, idempotency, authority, and post-commit ordering. Booking intake prefers the Form Lead where applicable; the deployed Granot Form sibling update mirrors job, priority and receiver to the qualified Call Lead. Do not turn this naming pass into a new pair ownership policy.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Target-specific checks:** Preserve these existing behaviors: [AC-32] contact and address paths are reference_only; low-risk paths stay stored; [AC-32] Change builders omit raw contact values and emit deterministic paths; [AC-32] no-op field collection emits no Change descriptors. See `src/services/domainCommands/entityChange.test.ts`.

## Source-verified implementation constraints (2026-10-29)

Keep pure field diff/classification separate from append-and-CAS persistence. Deduplicate field paths last-value-wins, sort them, omit raw before/after for contact/address/deletion/unknown reference_only paths, and never invent hashes. Preserve no_sync and granot_form_sibling diff paths, stored allowlist behavior and exactly +1 revision. Surviving aggregates CAS stamp last-change/revision; already-advanced revisions attach the stamp without another increment; deletes append the deletion Change and skip stamping a deleted aggregate. Prove private data omission, reordered-object equality, revision loss rollback and delete behavior.
