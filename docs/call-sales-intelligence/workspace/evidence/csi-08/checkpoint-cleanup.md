Fixed one substantiated issue:

- Customer-destination rejection events now identify the `OutreachRecord`, rather than incorrectly recording its ID as an `OwnerRepNudge`.
- Added a focused regression test for the event identity/metadata.

Changed:

- `src/services/salesIntelligence/nudges/commands.ts`
- `src/services/salesIntelligence/nudges/nudges.test.ts`

Rejected findings: none; the supplied review contained no findings, and no other concrete regression was confirmed during static audit.

Unresolved: none.

Validation: focused tests could not start because the isolated checkout’s `tsx` package is incomplete (`node_modules/tsx/index.js` missing). No dependencies were installed or configuration changed. Feature flags, auth, provider-send boundaries, and Mongo/API contracts remain unchanged.