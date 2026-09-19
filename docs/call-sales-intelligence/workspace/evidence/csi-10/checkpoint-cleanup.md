Fixed both substantiated review findings.

- CORS now permits `Idempotency-Key`, with an app-level CSI command preflight regression test in [app.test.ts](C:\Users\Pinda\Proyectos\vantage\vantage-main-server\.git\vantage-quality\runs\1789766173173-f7635836\workspace\src\app.test.ts).
- Restriction replay preserves the Contact Number revision while retaining the number-level serialization lock. Added replica regression coverage in [test-csi-outreach.replica.test.ts](C:\Users\Pinda\Proyectos\vantage\vantage-main-server\.git\vantage-quality\runs\1789766173173-f7635836\workspace\scripts\test-csi-outreach.replica.test.ts).

Rejected findings: none.  
Unresolved findings: none.

`git diff --check` passes. Typecheck and tests could not run because the isolated sandbox denies access to the shared pnpm/node_modules paths.