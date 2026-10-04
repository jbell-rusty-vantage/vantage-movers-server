# MongoDB as system of record

MongoDB is the authoritative store for Form Leads, Call Leads, Bookings, Cancellations, and related domain data. Every create or update writes to MongoDB first. Reporting Sheets are synchronized from MongoDB asynchronously — a successful API response does not guarantee sheets are already updated. Granot CRM receives form leads after the Mongo save (see ADR-0002), using the Lead ID as the cross-system link.
