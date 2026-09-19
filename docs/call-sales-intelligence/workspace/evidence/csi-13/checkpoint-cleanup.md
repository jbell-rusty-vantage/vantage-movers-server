Fixed the substantiated record-only number-analysis regression.

- Number refresh now returns terminal `no_transcript_evidence` when no currently eligible pinned transcript exists, before budget reservation or provider invocation: [sources.ts](/C:/Users/Pinda/Proyectos/vantage/vantage-main-server/.git/vantage-quality/runs/1789795679279-a540097e/workspace/src/services/salesIntelligence/analysis/sources.ts:89).
- Application coverage now rejects manifests with zero transcript pages, preventing legacy/malformed record-only submissions from publishing summaries: [coverage.ts](/C:/Users/Pinda/Proyectos/vantage/vantage-main-server/.git/vantage-quality/runs/1789795679279-a540097e/workspace/src/services/salesIntelligence/analysis/coverage.ts:4).
- Added focused regression coverage: [coverage.test.ts](/C:/Users/Pinda/Proyectos/vantage/vantage-main-server/.git/vantage-quality/runs/1789795679279-a540097e/workspace/src/services/salesIntelligence/analysis/coverage.test.ts:5).
- Updated the owning service documentation.

Rejected findings: none. Unresolved findings: none.

Validation was attempted but blocked by checkout infrastructure: local `tsx` cannot be resolved, and `pnpm exec` is denied access to its managed config file. No dependencies were installed.