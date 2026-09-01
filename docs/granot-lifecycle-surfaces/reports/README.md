# Completion reports

One report per issue, named `GLS-0<n>-completion.md`. An issue is not
`complete` in [`../PROGRESS.md`](../PROGRESS.md) until its report exists
here.

The contents are dictated by each issue's §14. The shared rules:

- **Evidence, not assertion.** Paste command output, counts, and response
  bodies. "Tests pass" is not evidence; the output is.
- **State what you did not do.** Every issue has a §7 out-of-scope list.
  Name them.
- **Correct the issue if reality differed.** Each issue's §4 was observed
  on 2026-09-01. If it had drifted, the fix belongs in the issue file and
  the divergence belongs in the report.
- **Redact.** No unmasked phone, email, full customer name, SMS body,
  provider payload, Sheet ID, or raw error in any pasted response,
  screenshot, or log.

The next issue reads these files before it reads its own issue. Write for
that reader.
