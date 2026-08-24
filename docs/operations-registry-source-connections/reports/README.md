# Completion reports

One report per pass, named `ORS-<n>-completion.md`. A pass is not `complete` in
[`../PROGRESS.md`](../PROGRESS.md) until its report exists here.

The contents are dictated by each issue's §14. The shared rules:

- **Evidence, not assertion.** Paste command output, counts, and response
  bodies. "Tests pass" is not evidence; the output is.
- **State what you did not do.** Every issue has a §7 out-of-scope list and this
  pack has deferred removals. Name them.
- **Correct the issue if reality differed.** Each issue's §4 was observed on
  2026-08-24. If it had drifted, the fix belongs in the issue file and the
  divergence belongs in the report.
- **Redact.** No unmasked phone, email, or full customer name in any pasted
  response, screenshot, or log.

The next pass reads these files before it reads its own issue. Write for that
reader.
