# Named 1–2 subject seed — handoff

- **Date:** September 19, 2026. Not CSI-15.
- **HEADs:** server `main` `93bfd1a85eba6ff157fdfa91701db63940e8498a` (1 ahead of origin, clean at inspect); Admin `main` `d82d3de45f56800378d223e7535688f4f0660366` (1 ahead, clean); MCP `9a8fd37bf78f8074011fb2d47ff3da3ec400b33d` clean, untouched. Remotes `jbell-rusty-vantage`.
- **Behavior:** two official Booked Call Leads now have closed official Outreach so Lead Actions / `outreach/by-lead` can open the matching subject. No Number Activity rows exist, so SI has no Number, no attachment, and no SI Play surface. P5562014 stored conversation remains on the conversation row only.
- **Checks:** [CHECKS.md](CHECKS.md).
- **Deployment:** none. Seeing the rows on the deployed API requires Owner `SALES_INTELLIGENCE_ENABLED` only. Do not enable `OUTREACH_ENSURE`, capture/media/STT/extraction/nudge, or `BACKFILL_DAYS` for this seed.
- **Next:** Owner flag enablement and CSI-09 Admin (local or after they push) to walk Lead Actions. Number/Play needs later capture, not this seed.
