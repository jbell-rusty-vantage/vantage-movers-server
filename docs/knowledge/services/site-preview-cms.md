---
type: Service
title: Main Site Preview Content
description: Owner-managed exact copy, images and testimonial selection for the isolated optimization preview.
tags: [main-site, testimonial]
status: active
stale_after: 2027-02-12
resource: src/services/sitePreviewCms/store.ts
applies_to:
  - src/services/sitePreviewCms/
  - src/sitePreviewApp.ts
  - src/config/sitePreview.ts
owners: [team:main-server]
---

# Main Site Preview Content

The Owner can edit the Main Site optimization preview from Admin without changing the live site. This service is mounted only in `sitePreviewApp.ts`, under `/api/v1/site-preview/cms`. The normal application and testimonial service do not mount or use it. Every database operation additionally requires `TEST_MODE=true`, `TEST_MONGO_DATABASE_NAME=testvantagemovers_sitepreview`, and that exact connected database name.

## Storage and ownership

`site_preview_content` holds one `main-site-optimization` document: a registered exact-source catalog, string overrides, testimonial policy and revision. `site_preview_content_revisions` stores immutable full snapshots with actor, request ID, date, action and changed keys. A transaction commits the current document and its history together. Saves and restores require the observed `expectedRevision`; stale edits return 409. Restore creates a new revision rather than deleting history. No-op saves leave the revision unchanged.

The catalog belongs to the preview site and is exported as `apps/main-site/src/content/cms/catalog.json` in the clients repository. `ops/site-preview/install-cms-catalog.ts` validates and installs it; an identical replay is harmless and different existing catalog content fails closed. Later source changes require a separately reviewed catalog migration, not an implicit overwrite of Owner edits. The API rejects unknown field keys and preserves text whitespace. Null overrides restore exact source defaults. The site renders strings as text, never executable markup. Publication approval, route identities, component variants, attribution and quote behavior remain outside this catalog.

Text templates preserve the original numbered placeholders and their occurrence counts; owners may reorder them while editing surrounding language. The canonical business phone accepts ten digits or eleven beginning with country code 1, with ordinary phone punctuation. The canonical business email accepts one valid address without whitespace, control characters or URL query/fragment syntax. The site derives phone/email actions from those same values so changing a label cannot silently leave its destination behind.

Raster uploads live in the isolated database's `site_preview_media.files` / `.chunks` GridFS bucket. This avoids a new provider or credentials for the bounded preview. Uploads accept PNG/JPEG/WebP only, with matching binary signatures, at most 2 MiB. Images are immutable; revisions retain prior references. Default image references are restricted to the registered catalog; other replacements must be an existing upload in this scope. No external URL fetch or SVG upload is accepted. The site exposes authenticated API images through a same-origin `/api/site-content/media/:id` proxy; no API credentials enter the browser. Upload responses return that local site path. Media reads set exact type, `nosniff` and restrictive CSP.

## Authentication and routes

Every route requires the API secret. All `/admin` routes also require a signed Owner dashboard actor using the existing seven-line Admin proxy HMAC contract. The preview has its own `VANTAGE_ADMIN_PROXY_SIGNING_SECRET`; no unsigned compatibility flag is honored and no extension actor is passed to verification. Admin must use a dedicated server-side preview proxy, never forward browser actor headers.

Responses use `{ok:true,data}`; failures use `{ok:false,error,code}`. Content and administrative reads use `no-store`.

| Method / suffix | Contract |
| --- | --- |
| GET `/` | `{revision,values,testimonialPolicy}`; overrides only, exact site source supplies defaults. |
| GET `/testimonials` | Paginated safe public projection, selected by the saved preview policy before pagination. |
| GET `/media/:id` | Immutable raster bytes from this scope. |
| GET `/admin` | Current snapshot plus catalog and update actor/date. |
| PUT `/admin` | `{expectedRevision,values?,testimonialPolicy?}`; values are partial string/null overrides. |
| GET `/admin/history` | Paginated revision summaries, changed keys and actors. |
| POST `/admin/restore` | `{expectedRevision,revision}`. |
| GET `/admin/testimonials` | Paginated review projection with `eligible` and `reason`; no customer/contact fields. |
| POST `/admin/media` | `{filename,contentType,base64}`; returns `{id,url,contentType,size}`. |

Pagination: `page` starts at 1; `limit` defaults 50 and is at most 100. Results contain `items,page,limit,total,has_next_page`.

## Testimonial rules

Default policy is `{minimumRating:4,excludedIds:[]}`. A review is selected only when `published === true`, its rating meets the inclusive minimum, and its ID is not excluded. Mongo applies all predicates before sorting/pagination. Owner browse explains `selected`, `excluded`, `below_minimum` or `unpublished`. Exclusion changes only preview selection; the original review, business response, publishing flags and other consuming sites remain unchanged. Ratings are integers 1–5 and exclusion IDs are validated, deduplicated and sorted.

Preview testimonials remain the isolated database's explicitly labeled fixtures unless separately populated. Production customer reviews are not copied by this feature or its catalog installer.

## Verification

Focused tests: `node --import tsx --import ./ops/test-setup.ts --test src/services/sitePreviewCms/*.test.ts src/config/sitePreview.test.ts`. They check unknown fields, reset/exact text, image signatures and limits, inclusive ratings/exclusions/unpublished state, Mongo query policy, API authentication, signed Owner requirements, path-bound signatures, stale-revision HTTP behavior and explicit preview route admission. Full transaction/media proof and deployed qualification are recorded by the task's release evidence, not inferred from unit tests.
