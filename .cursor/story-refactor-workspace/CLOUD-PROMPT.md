# Cloud prompt — retired traversal

The September service-by-service recommendation tour is closed. Do not reuse the former traversal prompt, resume its next-module pointer, or recreate recommendations removed by the 2026-10-29 refresh.

For an owner-requested recommendation review, use this brief:

```text
Review only the recommendation(s) the owner names in vantage-main-server.
Read .cursor/story-refactor-workspace/DIRECTIVE.md and CATALOG-STATUS.md first.
Read the matching current Service document, target code and callers.
Remove instructions for retired behavior; distinguish compatibility code from live workflows.
Keep useful, concrete naming and module-shape suggestions and target-specific parity checks.
Mark already-landed names as context, not work to repeat.
Do not implement, change policy, revive retired services or resume the September traversal.
Record what changed and the code/doc evidence. The refreshed brief remains a starting point,
not certification of functional parity or authorization for a runtime change.
```

Implementation is a separate owner-requested pass using the implementation skill and `../story-implementation-workspace/`. See [README.md](README.md).
