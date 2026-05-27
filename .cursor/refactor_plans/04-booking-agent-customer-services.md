# 04 Booking, Agent, And Customer Services Refactor

## Purpose

Extract booking lifecycle, booked-from-source workflow, agent allocation, booking mirroring, and customer behavior from `api/services/v1.service.ts`.

This is a higher-risk task because it touches graph consistency between source leads, booked leads, customers, agents, and sheet sync.

## Read First

- `api/services/v1.service.ts`
- `api/models/BookedLead.ts`
- `api/models/Customer.ts`
- `api/models/Agent.ts`
- `api/models/FormLead.ts`
- `api/models/CallLead.ts`
- `api/validation/v1.validation.ts`
- `api/services/leads/` if already created
- `api/services/sheetSync/` if already created

## Current Functions To Extract

Booking lifecycle:

- `createBookedLead`
- `createBookedLeadFromSource`
- `updateBookedLead`
- `findAllBookedLeads`
- `deleteBookedLead`
- `populateBookedLead`

Booking source workflow:

- `resolveBookingSourceLead`
- `effectiveBookingSourceCompany`
- `getFormLeadSourceCompanyForBooking`
- `findBestCallLeadMatchByPhone` if not already moved to lead phone matching

Agent allocation:

- `deriveBookedLeadAgentAllocations`
- `resolveAgentAllocations`
- `upsertAgentByName`
- `patchAgentAllocations`
- `resolveTotalBinderAmount`
- `buildBookedLeadWarnings`
- `primaryAgentName`
- `normalizeAgentName`

Customer behavior:

- `createCustomer`
- `updateCustomer`
- `findAllCustomers`
- `deleteCustomer`
- `upsertCustomerFromLead`

Booking mirror behavior:

- `refreshAttachedBookingFromLead`
- `mirrorBookingToLead`
- `clearBookingFromLead`
- `syncBookingAndSource` if not already moved to sheet sync

## Target Files

```text
api/services/bookings/
  bookedLead.service.ts
  bookedLeadFromSource.service.ts
  bookingSourceResolver.ts
  bookingMirror.service.ts
  bookingWarnings.ts
  index.ts

api/services/agents/
  agentAllocation.service.ts
  agentName.ts
  index.ts

api/services/customers/
  customer.service.ts
  customerFromLead.service.ts
  index.ts
```

Suggested ownership:

- `bookedLead.service.ts`: generic booking create/update/find/delete after source lead is known.
- `bookedLeadFromSource.service.ts`: Google Form/source booking workflow.
- `bookingSourceResolver.ts`: match form/call source lead, including call job/phone matching.
- `bookingMirror.service.ts`: write booking state back onto source leads.
- `bookingWarnings.ts`: zero binder and booking-specific warnings.
- `agentAllocation.service.ts`: agent upsert, allocation patch/replace, binder total calculation.
- `agentName.ts`: agent-name normalization.
- `customer.service.ts`: CRUD.
- `customerFromLead.service.ts`: customer upsert from booked lead/source lead workflow.

## Compatibility Exports

Keep these exported from `api/services/v1.service.ts`:

- `createBookedLead`
- `createBookedLeadFromSource`
- `updateBookedLead`
- `findAllBookedLeads`
- `deleteBookedLead`
- `createCustomer`
- `updateCustomer`
- `findAllCustomers`
- `deleteCustomer`
- `refreshAttachedBookingFromLead`

## Agent Instructions

1. Move agent allocation first; it is a distinct subdomain and can be tested independently.
2. Move customer create/update/find/delete and customer-from-lead upsert next.
3. Move booking source resolver before moving `createBookedLeadFromSource`.
4. Move generic booking lifecycle after resolver and agent/customer helpers compile.
5. Move booking mirror functions last, because they are coupled to lead and cancellation state.
6. Do not change positional delete parameters yet unless the route layer is also updated in the same task.
7. Keep sheet sync calls delegated to `services/sheetSync/`.
8. Re-export route-facing functions from `v1.service.ts`.
9. Run `pnpm typecheck` and `pnpm test`.

## Behavioral Invariants

- `createBookedLeadFromSource` must still support `FormLead` and `CallLead` flows.
- Call lead booking must still resolve by job number and/or normalized phone.
- Unmatched call booking behavior must remain unchanged.
- Agent allocation totals must still match `total_binder_amount`.
- Split agent behavior and zero binder warnings must not change.
- Customer upsert behavior must preserve existing matching by lead-derived customer fields.
- Booking mirror flags on source leads must remain consistent.
- Sheet sync scheduling must happen at the same points as before.

## Suggested Tests

- Agent name normalization and duplicate agent handling.
- Allocation patch versus replace.
- Total binder amount calculation and mismatch handling.
- Booked-from-form source resolution.
- Booked-from-call job-only, phone-only, job+phone, and no-match scenarios.
- Customer upsert from lead.
- Booking mirror update and clear behavior.

## Handoff To Next Agent

Report:

- Which booking functions still depend on `v1.service.ts` compatibility imports.
- Whether `bookingMirror.service.ts` is stable enough for cancellation extraction.
- Any coupling between customer delete cascade and booking delete cascade that should become a separate delete orchestration task.

The next agent should use booking mirror and source lookup services while extracting cancellation behavior.
