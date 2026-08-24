# Recommendation file

Write `.cursor/story-refactor-workspace/recommendations/<service>-<module>.md` (e.g. `leads-call-lead.md`). The quality bar file stays `form-lead.md`. Copy the headings below in this order. Do not add extra top-level sections.

The quality bar is [../../story-refactor-workspace/recommendations/form-lead.md](../../story-refactor-workspace/recommendations/form-lead.md).

```markdown
# <Module> — operational story

- Status: recommended
- Service: `leads` (Wave A, in-progress | visited)
- Pass: 2 of this service — `callLead.service.ts`
- Remaining in this service: `duplicateLead.service.ts`, …
- Target: `src/services/...`
- Knowledge: `docs/knowledge/services/...` or none
- Callers: 3–8 real import sites (not a dump)
- Seams callers need: e.g. begin / complete, public vs canonical command
- Split later (only if the file outgrows one sitting): story files, never CRUD

## What this file actually does

Number the operations. One sentence each. Not "a CRUD service."

## Organization

- Keep one file unless it cannot be read in one sitting.
- External **interface** table: today's export → story name → why the **seam** exists.
- Compatibility: old names stay as one-line aliases until callers migrate.
- The one type that earns a name (pending handoff), if any.
- No workflow class.

## The file, as a story

A TypeScript sketch of exports and story-beat functions, in reading order, grouped by operation (`// ── 1. …`). Parent functions stay deep. Child names exist only when they hide a real decision.

After the sketch, one paragraph that reads the primary path out loud.

## Precise logic I would tighten while renaming

Numbered smells the new names make obvious. Duplicate implementations, pass-through wrappers, lying names. Say what is out of scope (sibling modules, ADR reorder).

## Testing

The **interface** is the test surface. Bullet the operations a later implementer must prove. No helper-unit tests.

## What I would not do

Standing don't-do from the skill, plus any module-specific forbidden move.
```

Skip the module instead of writing a thin rename list. A recommendation that only swaps `createX` → `ingestX` and leaves a CRUD dump has failed. A recommendation that claims to cover a whole large service in one file has failed.
