# Booking Lead Model Resolution

## Current Behavior

`POST /api/v1/booked-leads` currently requires clients to send both:

- `lead_ref`: the Mongo ObjectId of the source lead.
- `lead_model`: either `FormLead` or `CallLead`.

The booking service uses those two fields together to load the linked source lead before creating the booking. Booking patches do not accept `lead_model`; they use the `lead_model` already stored on the booking.

`POST /api/v1/cancelled-leads` does not require `lead_model`. It receives `booked_lead`, loads that booking, and derives `lead_ref` and `lead_model` from the booking record.

## Possible Future Change

If we want clients to omit `lead_model` during booking creation, the API can resolve it server-side by checking which collection contains the provided `lead_ref`.

Suggested resolution flow:

1. Try to find a `FormLead` by `lead_ref`.
2. If no form lead exists, try to find a `CallLead` by `lead_ref`.
3. If exactly one source lead is found, use that document and collection type as the resolved `lead_model`.
4. If neither exists, return a 404 for the linked source lead.
5. If both somehow exist for the same ObjectId, return a 409 and require the client to provide `lead_model` explicitly.

This would make booking creation easier for clients while preserving the current stored booking shape: each booking should still persist both `lead_ref` and `lead_model` after the source lead is resolved.
