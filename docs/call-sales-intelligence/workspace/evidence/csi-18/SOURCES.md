# CSI-18 sources

Product authority: documents 01, 04, 05 and 10; shared CONTRACTS and ACCEPTANCE; the September 19 next-agent brief supersedes historical next-session sequencing. Owning Services are `sales-intelligence-analysis` and `sales-intelligence-outreach`. Documents 02/03/06 and the CSI-06/13/17 contracts/checks supply the storage, command and durable-runtime seams. CSI-08 INTAKE/CHECKS/SOURCES/HANDOFF/REVIEW describe the retained dashboard and guarded preview. The design export is reference material only and was not changed.

Executable authority: server Owner validation/router; `analysis/ownerCommands.ts`, `ownerReads.ts`, `ownerReanalysis.ts`; existing preparation/capture/submission/application/worker; CSI-06 transaction command adapter. Admin consumes those APIs through its existing Owner/Current BFF and query/live invalidation boundary. No MCP Owner command tools were added.

Direct evidence is in this directory: guarded replica logs, real BFF HTTP proof, browser DOM/AX captures and screenshots. The preview uses real Admin 3108 → API 3107 → loopback replica 27189 with synthetic persisted records. Credentials remain in the existing private OS-temp session file and are not part of this packet. The runtime test uses the actual local HTTP MCP/SDK transport with a fake model. No deployed MCP, paid model/STT, provider calls or production records were used.

Checkpoint evidence comes from `.git/vantage-quality/runs/1789822049070-ce55fc86`; it is an isolated snapshot, not the current checkout. See REVIEW for the exact result and selectively adopted fix.
