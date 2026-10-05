# Documentation contract (default)

This contract is used by the documentation stage of a quality checkpoint when the repository does not name its own (`docsContract` in `.quality.config.json`).

1. **Find the owner.** Map each changed path to the narrowest document that already describes it: a service or module doc, a glob-scoped agent rule (`.cursor/rules/*.mdc`, `CLAUDE.md`, `AGENTS.md`), a runbook, the README, an index or catalogue page. Prefer updating an existing owner to creating a new file.
2. **Read code first.** The current code and its tests are the authority. Read the implementation and the document before changing either; never update from memory or from the diff alone.
3. **Change only what is stale:**
   - behaviour, inputs/outputs and invariants that changed;
   - routes, commands, flags, environment variables, jobs and data models that were added, renamed or removed;
   - links and paths that moved.

   Keep the document's structure and voice. If it is already accurate, say why and change nothing.
4. **Removed features:** mark them as removed or retired where the repository has that convention. Otherwise delete the stale description and leave a one-line pointer to what replaced it.
5. **Do not:**
   - invent policy or terminology;
   - rewrite specifications, decision records, contracts or ledgers to match the code (report the contradiction instead);
   - mark planned work as done;
   - duplicate content that lives elsewhere (link to it).
6. **Report:** documents changed, and the reason for each. Then contradictions found but not resolved, and remaining gaps.
