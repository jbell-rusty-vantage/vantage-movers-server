# Local task ledger

Preparation state as of 2026-10-04: ready for cloud implementation, with no task claimed or accepted. Record repository, branch, HEAD and initial dirty files when you claim. Work packages are defined in [IMPLEMENTATION-PLAN.md](../IMPLEMENTATION-PLAN.md) §7.

| ID | Lane | Depends on | Status | Claimed files / checkout | Evidence / next handoff |
| --- | --- | --- | --- | --- | --- |
| SRV-0/1/2/3/7/8/9/T | Server S1 foundation & API | none | ready | unclaimed | models early → S3; DTOs → ADMIN |
| SRV-4 | Server S2 engine | none | ready | unclaimed | engine types → S1/S3 |
| SRV-5 | Server S3 capture | none | ready | unclaimed | E01 proof script → operator |
| SRV-6 | Server S3 goals/evidence | SRV-3 models | ready | unclaimed | → S1 reads |
| ADM-1/2/7 | Admin A1 roles/route/BFF | none | ready | unclaimed | → A2 |
| ADM-3/4/5/6/8 | Admin A2 desks | mock DTOs; server DTOs later | ready | unclaimed | → VERIFY |
| VERIFY | Integrated replica + browser | server + admin merged into feat/outreach-desk | blocked | — | END-TO-END-RUN §3–§5 evidence |

Allowed states: ready, claimed, in_progress, review, blocked, accepted. Only VERIFY or the coordinator marks a cross-service item accepted, and only with evidence. A blocking issue names the decision or proof ID, the concrete failing scenario, the owning lane and what it depends on. A skipped test is not accepted.
