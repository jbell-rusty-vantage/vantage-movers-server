# Granot CRM posting survives non-critical downstream failures

When `post_to_granot` is true and the lead is not a duplicate, the server must still attempt CRM Posting after the Form Lead is persisted to MongoDB — even if other post-save steps fail (sheet sync finalization, operational events, form-fill side effects on call leads, etc.). The owner’s sales workflow in Granot CRM must not be blocked by reporting or observability failures. Duplicate leads always skip CRM posting. The lead must exist in MongoDB first because Granot `leadno` is the Lead ID.

**Intended post-save order (happy path):** persist Form Lead to MongoDB → CRM Posting (uses Lead ID as `leadno`) → Sheet Sync → operational events and other non-critical side effects. CRM Posting requires the Mongo `_id`; it must run after create, not before.

**Failure handling:** If an error occurs before CRM Posting completes in the normal path, the server should still attempt CRM Posting with best effort (when posting is enabled and the lead is not a duplicate). Sheet sync and observability failures must not prevent Granot from receiving the lead.

**Known implementation gap (not critical right now):** `formLead.service.ts` currently runs `finalizeSheetSync` before `submitFormLeadToCrm`. A sheet sync failure can block CRM Posting, and the order is reversed from the intended happy path (CRM before sheet sync). Fixing this is deferred — document and align when prioritised.
