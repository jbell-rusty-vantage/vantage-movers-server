---
type: Strategy
title: Portable, continuously maintained documentation for Vantage
description: Decision options and rollout plan for agent-readable coding and business-logic documentation across Vantage repositories.
tags:
  - documentation
  - business-logic
  - agent-context
  - okf
  - openwiki
status: draft
stale_after: 2026-09-17
generated:
  by: codex/research-agent
  at: 2026-08-17T15:24:20Z
sources:
  - id: okf-spec
    resource: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md
    title: Open Knowledge Format specification
    author: org:GoogleCloudPlatform
  - id: openwiki
    resource: https://github.com/langchain-ai/openwiki
    title: OpenWiki repository and documentation
    author: org:langchain-ai
  - id: cursor-search
    resource: https://cursor.com/docs/agent/tools/search
    title: Cursor Agent search documentation
    author: org:cursor
  - id: codex-agents
    resource: https://learn.chatgpt.com/docs/agent-configuration/agents-md
    title: Codex AGENTS.md documentation
    author: org:openai
  - id: claude-memory
    resource: https://docs.anthropic.com/en/docs/claude-code/memory
    title: Claude Code project memory documentation
    author: org:anthropic
---

# Portable, continuously maintained documentation for Vantage

## Recommendation in one page

Adopt **OKF v0.2 as the portable documentation contract**, not as the retrieval
engine. Pilot **OpenWiki as a replaceable generator** for code-derived material,
while keeping business rules, architectural decisions, and operational runbooks
human-owned and review-gated.

For `vantage-main-server`:

1. Make `docs/` the canonical home for curated domain and business knowledge.
2. Add an OKF v0.2 profile, a root `docs/index.md`, link validation, and explicit
   code-to-document ownership metadata.
3. Migrate the useful `.cursor/businesslogic/` material into the canonical
   corpus instead of maintaining a second Cursor-only truth.
4. Keep `AGENTS.md`, `CLAUDE.md`, and `.cursor/rules/` deliberately small. They
   should route agents to `docs/index.md` and the right concept documents, not
   duplicate the documents.
5. Run cheap deterministic documentation checks on every pull request.
6. Run OpenWiki from a scheduled GitHub Action against the default branch. It
   must open a reviewable documentation PR; it must not push to `main` or
   auto-merge.
7. Treat OpenWiki's output as unverified until a maintainer reviews it. OpenWiki
   currently advertises OKF v0.1 output, while the current OKF specification is
   v0.2. That version gap needs an explicit validator/migration step.

This hybrid gives Vantage the portability of plain Markdown, YAML, links, and
Git without tying correctness to one editor's hidden index or one documentation
vendor.

## The important distinction: storage is not retrieval

There are three separate concerns:

| Concern | Recommended owner | Why |
| --- | --- | --- |
| Durable knowledge format | OKF-flavored Markdown in Git | Portable, readable, diffable, tool-neutral |
| Discovery and retrieval | Thin agent entrypoints plus file/semantic search | Works with Cursor, Codex, Claude Code, and ordinary tools |
| Maintenance | Deterministic checks plus review-gated agent updates | Automation finds drift; humans retain authority over business meaning |

OKF solves the first concern. OpenWiki helps with the third. Cursor's semantic
index, Codex's file tools, and Claude Code's file tools address the second in
different ways. No one of these should be allowed to become the only doorway to
Vantage knowledge.

## What the agents actually discover

### Cursor

Cursor explicitly builds a semantic index of the codebase and combines semantic
search with exact/regex search. Its documentation says all codebases in a
multi-root workspace are indexed automatically. Files excluded by `.gitignore`,
`.cursorignore`, or `.cursorindexingignore` may be absent from semantic search;
`.cursorignore` also restricts normal Agent access. See [Cursor Search](https://cursor.com/docs/agent/tools/search),
[secure codebase indexing](https://cursor.com/blog/secure-codebase-indexing), and
[ignore files](https://cursor.com/docs/reference/ignore-file).

Cursor also supports root and nested `AGENTS.md` files. Its richer `.mdc` rules
can be always loaded, selected by description, or scoped by glob. Cursor itself
recommends referencing files instead of copying their contents into rules, to
keep rules short and avoid drift. See [Cursor Rules](https://cursor.com/docs/rules).

Implication: Markdown documentation in Git is naturally retrievable by Cursor
as long as it is not ignored, but a small `AGENTS.md`/rule pointer still improves
discovery and tells the agent which documents are authoritative.

### Codex

Codex documents deterministic `AGENTS.md` discovery: it reads a global file,
then walks from the project root to the working directory, combining at most one
instruction file per directory. The documented default combined limit is 32
KiB. See [Codex AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md).

The official documentation reviewed for this strategy does not establish a
persistent, user-visible repository embedding index comparable to Cursor's.
Codex can search and read workspace files, but the safe design assumption is
that only `AGENTS.md` is guaranteed startup context and everything else must be
discoverable through clear paths, indexes, links, and ordinary search.

Implication: do not stuff the wiki into `AGENTS.md`. Put a compact routing table
there and make the documentation graph easy to traverse with standard files and
links.

### Claude Code

Claude Code loads `CLAUDE.md` files as project memory and discovers more-specific
files when it reads within subdirectories. Anthropic recommends keeping each
`CLAUDE.md` below roughly 200 lines and using imports or path-scoped rules for
larger bodies of knowledge. Claude Code reads `CLAUDE.md`, not `AGENTS.md`, but
its documentation recommends a tiny `CLAUDE.md` containing `@AGENTS.md` when a
repository already uses the cross-tool convention. See [Claude Code memory](https://docs.anthropic.com/en/docs/claude-code/memory).

The reviewed Claude Code documentation describes instruction loading and file
search tools, but not a persistent codebase semantic index comparable to
Cursor's. This is another reason to optimize for portable navigation rather
than an editor-specific embedding store.

### Cross-tool rule

The reliable common denominator is:

```text
AGENTS.md / CLAUDE.md / .cursor rule
                 |
                 v
            docs/index.md
                 |
                 v
       small linked concept documents
                 |
                 v
       source files, schemas, tests, ADRs
```

Agents should be told to cite the documents and source files used in an answer.
That makes retrieval inspectable even when the underlying search ranking is not.

## What OKF contributes

The current [OKF specification](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
is version 0.2. An OKF bundle is a directory of Markdown files with YAML
frontmatter and normal Markdown links. The path is the concept identity. The
format deliberately requires no service, SDK, vector database, or renderer.

OKF v0.2 is especially relevant to continuously generated documentation because
it adds explicit provenance and trust fields:

- `sources` records the code, schema, ADR, ticket, or external material from
  which a document was derived;
- `generated` records which process produced the current content and when;
- `verified` records machine or human verification separately from generation;
- `status` distinguishes `draft`, `stable`, and `deprecated` concepts;
- `stale_after` makes freshness mechanically checkable; and
- standard Markdown links form the traversable graph.

OKF does **not** define retrieval, ranking, hosting, authorization, or a complete
taxonomy. Vantage still needs a local profile and validation rules.

### Proposed Vantage OKF profile

Every canonical concept document should have:

```yaml
---
type: Business Rule
title: RingCentral call qualification
description: Rules that determine whether a RingCentral call becomes a Call Lead.
tags: [ringcentral, call-lead, qualification]
status: stable
stale_after: 2026-11-17
sources:
  - id: evaluator
    resource: ../../src/services/ringcentral/callQualificationEvaluator.ts
  - id: tests
    resource: ../../src/services/ringcentral/callQualificationEvaluator.test.ts
verified:
  - by: human:maintainer
    at: 2026-08-17T15:00:00Z
owners: [team:main-server]
applies_to:
  - src/services/ringcentral/**
---
```

`owners` and `applies_to` are Vantage extension fields. OKF permits additional
keys. They are useful because a deterministic drift check can map a code diff to
the documents that claim to explain it.

Rules for the profile:

- Generated content starts as `status: draft` and has `generated`, but no human
  `verified` event.
- Automation must never fabricate a `human:` verifier.
- `generated.at` changes only when content meaningfully changes, not on every
  scheduled run.
- `stale_after` depends on volatility: 30 days for integration behavior, 90
  days for active business rules, and 180 days for stable architecture.
- Every important claim links to source code, a test, an ADR, or an external
  authoritative source.
- `docs/index.md` declares `okf_version: "0.2"` and links concepts with their
  descriptions. Index and log files follow OKF's reserved-file rules.

## Current `vantage-main-server` baseline

The repository already contains high-value documentation; the problem is
placement and lifecycle, not absence.

- `docs/` contains 33 Markdown files and no YAML frontmatter.
- `.cursor/businesslogic/` contains compact service-level business-logic
  documentation for leads, bookings, cancellations, Sheet Sync, RingCentral,
  Operations Registry, search, and related services.
- `.cursor/rules/` contains path-scoped implementation and safety rules.
- `.cursor/index.md` describes a three-layer model, but several canonical links
  point outside `vantage-main-server`, and the business-logic layer is housed
  under an editor-specific directory.
- Root `AGENTS.md` points readers to `CLOUD_AGENTS.md` and `.cursor/rules/`.
  This works well for Cursor but does not give Codex a concise, canonical
  business-documentation index.
- There is no root `CLAUDE.md`, so Claude Code has no explicit shared entrypoint
  for the existing `AGENTS.md` or business-logic corpus.

The `.cursor/businesslogic/` files should be migrated, not regenerated from
scratch. They encode real owner rules and are better seeds than a fresh model
summary of the code.

## Options

| Option | Portability | Maintenance automation | Business-rule trust | Initial effort | Recommendation |
| --- | --- | --- | --- | --- | --- |
| A. Editor-native rules only | Low | Low to medium | Medium | Low | Do not choose as the system of record |
| B. OpenWiki as-is | High (OKF v0.1) | High | Low until reviewed | Low | Good experiment, incomplete governance |
| C. Hand-built OKF v0.2 pipeline | Very high | Medium | High | High | Strong control, too much first-step plumbing |
| D. OKF v0.2 contract + OpenWiki producer + review gates | Very high | High | High | Medium | **Recommended** |
| E. Hosted wiki/RAG service as source of truth | Low to medium | High | Vendor-dependent | Medium | Use only as an optional consumer/viewer |

### Option A: editor-native rules only

Continue expanding `.cursor/rules`, `.cursor/businesslogic`, `AGENTS.md`, and
`CLAUDE.md` independently. This can produce excellent behavior in one editor,
but it duplicates truth and encourages tool-specific forks. Rules are valuable
as routing and enforcement context; they are a poor portable knowledge store.

### Option B: OpenWiki as-is

[OpenWiki](https://github.com/langchain-ai/openwiki) generates a linked Markdown
wiki, maintains an `AGENTS.md` and `CLAUDE.md` pointer block, uses Git diffs for
incremental updates, supports `.openwikiignore`, can render a local graph, and
ships a scheduled GitHub Actions example that opens a PR. It supports multiple
model providers and is MIT licensed.

This is the fastest way to test automatically maintained repo documentation.
However, its current documentation says it emits **OKF v0.1**, while Google's
current specification is **OKF v0.2**. In particular, v0.1 uses `timestamp` and
a body citation list where v0.2 prefers `generated.at` and frontmatter
`sources`. OpenWiki output should therefore be version-pinned and validated,
not described loosely as "latest OKF."

The larger risk is epistemic: a model can write a plausible but incorrect
business rule. OpenWiki is well suited to code maps, flows, module summaries,
and candidate drift fixes. It must not silently promote inferred policy to
human-verified business truth.

### Option C: hand-built OKF v0.2 pipeline

Write Vantage-specific scripts to extract API routes, service dependencies,
schemas, cron registrations, and test coverage into OKF v0.2 documents. Add a
small LLM step only for prose synthesis.

This offers the best provenance and deterministic repeatability, but it creates
a documentation product that Vantage must maintain. It is worthwhile later for
high-value generated facts such as route catalogs and schema inventories, not
as the first complete solution.

### Option D: hybrid (recommended)

Use OKF v0.2 as the acceptance contract. Use several replaceable producers:

- humans for business rules, decisions, and runbooks;
- deterministic scripts for route/schema/config/test inventories; and
- OpenWiki for code-derived narrative, maps, and change proposals.

All producers write reviewable Git changes. A Vantage validator checks
frontmatter, source paths, links, lifecycle, and the declared OKF dialect. The
agent generator is replaceable without replacing the corpus.

### Option E: hosted wiki or opaque RAG

Products such as hosted code wikis can be useful viewing or retrieval layers,
but should consume or mirror the Git corpus. They should not become the only
place where a Vantage business rule exists. Export quality, offline access,
index observability, and vendor continuity are weaker than plain files.

## Automation design

### Pull-request workflow: deterministic and blocking

Run on every pull request without model-provider secrets:

1. Parse YAML frontmatter and validate the Vantage profile.
2. Check local Markdown links and all `sources[].resource` paths.
3. Build a document graph and report orphan concepts.
4. Compare changed paths with `applies_to`. If documented code changed without
   a corresponding documentation change or explicit exemption, fail with the
   exact documents that may be stale.
5. Reject a new `human:` verification event unless it came through an approved
   maintainer review path.
6. Report concepts whose `stale_after` date has passed.
7. Validate Mermaid syntax and any generated route/schema inventories.

This workflow detects objective drift. It should not ask an LLM to decide
whether a pull request is correct.

### Scheduled workflow: generative and review-gated

Use one GitHub Actions workflow with `workflow_dispatch` and `schedule`. The
schedule is the cron job; a separate pull-request workflow is the continuous
gate. Run at a non-round minute to reduce GitHub schedule congestion, for
example daily at `17 7 * * *` in `America/New_York`.

The scheduled job should:

1. check out full history (`fetch-depth: 0`) so OpenWiki can inspect changes
   since its last documented commit;
2. install a pinned OpenWiki version and pinned validation dependencies;
3. apply a strict `.openwikiignore` before any provider receives content;
4. run `openwiki code --update --print`;
5. run the Vantage OKF validator/migrator;
6. run link, graph, Mermaid, and stale-document checks;
7. open or update a single `docs/automated-update` pull request; and
8. attach a summary listing changed concepts, source commits, validation
   results, provider/model, and estimated cost.

Use least-privilege `contents: write` and `pull-requests: write` only in this
job, pin third-party actions by commit SHA, add concurrency, and never
auto-merge. GitHub's [schedule documentation](https://docs.github.com/actions/using-workflows/events-that-trigger-workflows#schedule)
notes that scheduled workflows run from the default branch. The workflow must
also support manual dispatch for recovery and testing.

Do not run the provider-backed updater on untrusted fork pull requests: secrets
would be unsafe and arbitrary repository content can act as prompt injection.

### Local command and optional machine cron

Expose the same implementation through repository commands, for example:

```text
pnpm docs:validate
pnpm docs:inventory
pnpm docs:update
pnpm docs:eval
```

A developer can run these from Cursor, Codex, Claude Code, cron, or Windows Task
Scheduler. GitHub Actions remains the canonical scheduled writer. A separate
machine cron, if desired, should run `docs:validate` and alert on failure rather
than create a second competing stream of documentation commits.

## Source boundaries and security

The first `.openwikiignore` should exclude at least:

```gitignore
.env*
agent_granot_credentials/
node_modules/
.git/
dist/
build/
coverage/
tmp/
**/*.pem
**/*.key
**/*secret*
scripts/**/reports/raw/**
```

It must be reviewed against the actual repository before the first generation
run. OpenWiki describes `.openwikiignore` as a read boundary, which is stronger
than relying only on prompt instructions. Provider retention and training terms
must still be reviewed before sending private code.

Generated documentation is untrusted input until reviewed. It may contain
incorrect business rules, leaked values from allowed files, or instructions
copied from source comments. The update workflow should make changes visible,
small, attributable, and reversible.

## Retrieval transparency and evaluation

Indexes will always have some opacity. Make the result auditable instead of
trying to make every vendor's ranking algorithm visible.

Create `docs/evals/retrieval-cases.yaml` with 15–25 questions such as:

- What makes a RingCentral call eligible to become a Call Lead?
- Which system is authoritative for booking and cancellation state?
- When may a Source Company use direct Sheet writes?
- What identity wins when matching a Granot record to a Form Lead?
- Which failures may occur after a Form Lead is persisted without rolling it
  back?

Each case should name expected concept documents, expected source files, and
facts that must appear. Monthly, run the same set in Cursor, Codex, and Claude
Code and record:

- whether the authoritative document was found;
- whether the answer cited the document and source code;
- factual correctness;
- stale or contradictory sources encountered; and
- unnecessary context loaded.

The target is not identical search traces. The target is consistent discovery
of the same canonical concepts with inspectable citations.

## Rollout plan

### Phase 0: freeze the contract (one small PR)

- Approve OKF v0.2 plus the Vantage extension fields.
- Add `docs/index.md`, the schema/profile, and `docs:validate`.
- Add thin routing text to root `AGENTS.md`.
- Add root `CLAUDE.md` containing `@AGENTS.md` plus only Claude-specific notes.
- Add or update one Cursor rule that points to `docs/index.md` rather than
  restating business rules.

Exit criterion: all three agents can start from their native instruction file
and reach the same documentation index.

### Phase 1: migrate two high-value vertical slices

Start with:

1. RingCentral call qualification and Call Lead creation; and
2. Operations Registry resolution, authorization, and audit.

Move the relevant `.cursor/businesslogic/` documents into a canonical
`docs/knowledge/business-logic/` location, add v0.2 frontmatter and source links,
update all incoming links, and leave a temporary deprecation pointer under
`.cursor/businesslogic/`. Do not maintain two full copies.

Exit criterion: a maintainer confirms the migrated documents against tests and
source, and retrieval cases pass in Cursor, Codex, and Claude Code.

### Phase 2: OpenWiki pilot

- Run OpenWiki on a branch with `.openwikiignore` and a carefully written
  `openwiki/INSTRUCTIONS.md`.
- Tell it that curated `docs/knowledge/` business rules are authoritative and
  must be cited rather than reinterpreted.
- Compare generated maps and flows to the two verified slices.
- Measure cost, update churn, false claims, useful discoveries, and review time.
- Decide whether to keep OpenWiki's default `openwiki/` bundle as a generated
  companion or add a controlled v0.1-to-v0.2 import into `docs/generated/`.

Do not merge the scheduled workflow until this pilot has two clean update runs.

### Phase 3: automate `vantage-main-server`

- Add the deterministic PR workflow.
- Add the scheduled/manual OpenWiki update workflow.
- Migrate the remaining `.cursor/businesslogic/` files in small groups.
- Generate deterministic route, schema, scheduled-job, and integration
  inventories.
- Add the retrieval evaluation set and a monthly review reminder.

Exit criterion: code changes identify affected documents, scheduled updates
open clean PRs, and no editor-specific directory owns unique business truth.

### Phase 4: roll out by domain authority

Apply the same profile and reusable validation command in this order:

1. `vantage-main-server` — canonical domain rules and integration behavior;
2. `vantage-admin` — owner workflows, permissions, and UI-to-command mapping;
3. `granot_sync_extensions_and_services` — browser/CRM protocol and execution
   boundaries; and
4. `vantage-movers-clients` — public-client behavior and API dependencies.

Each repository remains independently cloneable and understandable. Cross-repo
concepts link to stable GitHub URLs and identify which repository is
authoritative. Shared generated tooling may live in a reusable action, but the
schema and minimum validator must remain vendored or version-pinned so one
repository is not unusable when another is unavailable.

## Decision gates

Proceed with the recommended hybrid if the pilot meets all of these:

- at least 90% of generated factual claims in the two pilot slices are correct;
- every generated claim can be traced to a source document or code path;
- update PRs are materially smaller than a fresh regeneration;
- average human review time is lower than manually maintaining the equivalent
  documents;
- no secret or ignored path appears in prompts, traces, or output;
- the v0.1/v0.2 conversion is deterministic and idempotent; and
- all three agents find the same authoritative source for at least 80% of the
  initial retrieval cases.

If OpenWiki fails these gates, keep the OKF corpus and replace only the
generator. That replaceability is the central architectural benefit.

## Sources and date sensitivity

Research for this strategy was performed on 2026-08-17. The relevant projects
are moving quickly, so `stale_after` is intentionally short.

- [Google Cloud announcement: Open Knowledge Format](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing)
- [OKF v0.2 specification](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
- [LangChain announcement: OpenWiki](https://www.langchain.com/blog/introducing-openwiki-an-open-source-agent-for-repo-documentation)
- [OpenWiki repository and scheduled workflow example](https://github.com/langchain-ai/openwiki)
- [Cursor Search](https://cursor.com/docs/agent/tools/search), [Rules](https://cursor.com/docs/rules), and [Ignore File](https://cursor.com/docs/reference/ignore-file)
- [Codex AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [Claude Code project memory](https://docs.anthropic.com/en/docs/claude-code/memory)
- [GitHub Actions scheduled workflows](https://docs.github.com/actions/using-workflows/events-that-trigger-workflows#schedule)
