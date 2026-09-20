# AFTER-16 A checks

| Command | Result |
| --- | --- |
| `node --import tsx scripts/test-csi-rep-identity.ts` | PASS 13/13, zero skipped. Includes `eligible re-evaluation with empty recordings still enqueues discovery`. Disposable replica `csi01:27189`. No `.env`. Flags remain off except the replica runner's existing ENABLED / attachment / outreach locals. |

No production flag write. No provider call. No send.
