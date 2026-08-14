# Lead Lifecycle review warnings

Open findings from unit reviews. They do not block the next unit’s contract refinement. Resolve them when the owning files are already open, or in the suggested later unit. Do not treat this folder as an implementation contract; the final specification still wins.

Status vocabulary: `open`, `resolved`. Severity: `warning` (behavior or verify gap) or `nit` (proof, label, or docs).

When resolving: update the item file to `resolved`, name the unit/PR that fixed it, and move the row in the tables below.

## Open warnings

| ID | Unit | Summary | Suggested window |
| --- | --- | --- | --- |
| [W-02-01](W-02-01-legacy-index-verify.md) | 02 | Index `--apply` does not create the two legacy indexes that `--verify` requires | Unit 31, or the next edit to `granot-lifecycle-indexes` |
| [W-02-02](W-02-02-apply-redact-only-when-hash-absent.md) | 02 | Native receipt apply redacts only when `payload_sha256` is absent | Unit 03 capture path, or the next edit to receipt apply |

## Open nits

| ID | Unit | Summary | Suggested window |
| --- | --- | --- | --- |
| [N-02-01](N-02-01-write-once-save-test.md) | 02 | Write-once save test is `isNew=false`, not a persisted round-trip | Next edit to `GranotObservationReceipt.test.ts` |
| [N-02-02](N-02-02-last-error-ac-tag.md) | 02 | `last_error.message` maxlength test is tagged `[AC-02]` | Next edit to that test |
| [N-02-03](N-02-03-created-at-capture-time.md) | 02 | `received_at \|\| createdAt` createdAt-only path is untested | Next edit to receipt compatibility tests |
| [N-02-04](N-02-04-masked-manifest-ids.md) | 02 | Public manifests store masked IDs; 34.7 rollback must re-scan | Unit 31 / 34.7 rollback script |

## Resolved

none
