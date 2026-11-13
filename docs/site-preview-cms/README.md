# Preview content management — November 12, 2026

The API implementation closes the server part of Owner editing for the optimization preview: registered exact copy, immutable images, revision history/restore, and minimum-star plus explicit-exclusion testimonial selection. [Service contract](../knowledge/services/site-preview-cms.md).

## Local evidence

- Eight focused CMS/auth/isolation tests passed, including signed Owner enforcement and stale-revision HTTP behavior. Focused ESLint passed.
- [Disposable loopback Mongo proof](evidence/loopback-proof.json) passed catalog replay, durable edits, stale revision, concurrent writers (exactly one accepted), GridFS bytes and reuse, published/rating/exclusion selection, and restore history. Harness: `ops/site-preview/cms.replica.ts`; no production connection or data.
- The source catalog available at verification time (2,291 fields) passed the backend registration schema. This is schema compatibility, not a final inventory or deployed catalog receipt.
- Full local typecheck finished with five pre-existing diagnostics exclusively in the ignored `ops/output/pool-active-canonical-audit.ts` scratch file (four extensionless Node16 imports and one implicit-any parameter); it reported no CMS diagnostics. Full CI typecheck remains mandatory before release acceptance; the isolated-preview workflow now includes the CMS tests.

## Remaining integration proof

Deploy only the isolated API branch/project, configure its dedicated Admin signing key, install the final exact catalog, and verify Admin save → preview render, image upload → preview image, testimonial selection, history/restore, and unauthorized access on deployed source. The main/production website remains outside this implementation. Record deployed identities and acceptance here or in the owning task's shared handoff; local tests do not establish deployed behavior.
