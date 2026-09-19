# CSI-10 production seed checks — September 19, 2026

## Live seed (production Mongo `vantagemovers`, local API `:3010`)

- Flags in that process only: `SALES_INTELLIGENCE_ENABLED=true`, `SALES_INTELLIGENCE_DIRECTORY_SYNC=true`, `SALES_INTELLIGENCE_DEPLOYMENT_ID=csi-production`. Nudge/STT/extraction/media/capture/outreach/attachment flags unset.
- Directory cron `POST /api/cron/sales-intelligence-directory-sync`: `ok:true`, `changed:true`, snapshot `6aaea089984b82cb35a76522`, digest `3608304979327bdf6a1f542b077716960cfec469a4fdef90206f4ce4290d352c`, counts `{extensions:53,users:24,departments:23,company_numbers:61,queues:23}`, `pruned:0`, `truncated:false`, `requests:27`, `runtime_ms:11054`.
- Name guards: ext 121 still Benjamin (not Jason); Tyler D 209 and Tyler S 129 still Tyler. Unique first-token Users still present.
- `POST /reps/propose` against that snapshot: 9 unique proposed, 15 unmatched, 0 ambiguous. Never linked Jason/121, either Tyler, Russell, Daniel/QA, Joshua, or Roy.
- Owner `POST /reps/:id/review` on those 9 only: all `reviewed` / `sales_rep`. Sean (2 DIDs) pager only. The other eight pager + `sms_to_rep`. No `rc_team_messaging_person_id`.
- `GET /reps`: 9 reviewed sales-rep links, 0 remaining proposed links. Directory Users still unmatched except the stored propose evidence for the nine unique names.
- `owner_rep_nudges` count: **0** before and after.

## Source checks

- Server `tsc --noEmit`: exit 0.
- Admin `tsc --noEmit` and `lib/api/salesIntelligence.test.ts`: **7/7**, including the review-channel helper.
- Focused identity unit: **6/6**.
- `pnpm test:csi:rep-identity:replica`: **12/12** on disposable `testvantagemovers_csi10*` / replica `csi01`.

## Browser

Owner sign-in on local Admin `:3011` pointed at the seed API. Reps loaded for account `62948571023`. Nine reviewed rows, Sean pager-only, unmatched directory Users visible, messaging copy still disabled, no Review buttons left. [browser-reps.ax.txt](browser-reps.ax.txt). The review dialog was not re-submitted from the browser because no proposed rows remained.

## Required quality checkpoint

See [REVIEW.md](REVIEW.md). Source checks above are not that isolated snapshot.
