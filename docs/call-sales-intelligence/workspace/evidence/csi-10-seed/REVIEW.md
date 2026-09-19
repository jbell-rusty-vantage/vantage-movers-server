# CSI-10 production seed review notes

Source vs checkpoint are separate.

## Source (this session)

Identity unit 6/6, identity replica 12/12, Admin helper tests 7/7, server/Admin typecheck exit 0. Live directory + 9 Owner reviews persisted. No send. Josh/Roy unmatched because Agents have no aliases; that is a recorded limit, not a matcher defect.

## Required isolated checkpoint

The command `pnpm finish-work --provider cursor --no-apply` is recorded in CHECKS after it finishes. A stale/failed isolated snapshot is not independent current-source approval, even if its internal QUALITY_RESULT is PASS.

## Out of scope

CSI-14 dialogs and P2, CSI-09, CSI-15, flag-on analysis, Vercel flag enablement, full CSI index migration, Agent alias writes, invented Josh/Roy links.
