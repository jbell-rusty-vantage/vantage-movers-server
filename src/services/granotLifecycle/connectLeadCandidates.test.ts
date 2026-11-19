import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { inspect } from "node:util";
import mongoose from "mongoose";
import { toObjectId } from "../../utils/objectId";
import { BookedLead } from "../../models/BookedLead";
import { BookingLeadReconciliationCase } from "../../models/BookingLeadReconciliationCase";
import { getCallLeadModel } from "../../models/CallLead";
import { getFormLeadModel } from "../../models/FormLead";
import { getGranotRecordLinkModel } from "../../models/GranotRecordLink";
import { GRANOT_LIFECYCLE_ERROR_CODES } from "./errors";
import { listConnectLeadCandidates } from "./projections";

type MutableModel = {
  find: unknown;
  findById: unknown;
  findOne?: unknown;
  exists?: unknown;
};

type QueryCapture = {
  filter?: unknown;
  projection?: unknown;
};

let FormLead: MutableModel | undefined;
let CallLead: MutableModel | undefined;
let originalFormFind: unknown;
let originalCallFind: unknown;
const originalBookingFindById = BookedLead.findById;
const originalCaseExists = BookingLeadReconciliationCase.exists;
const Link = getGranotRecordLinkModel() as unknown as MutableModel;
const originalLinkFindOne = Link.findOne;

const bookingId = new mongoose.Types.ObjectId();
const formLeadId = new mongoose.Types.ObjectId();
const callLeadId = new mongoose.Types.ObjectId();

afterEach(() => {
  if (FormLead && originalFormFind) FormLead.find = originalFormFind;
  if (CallLead && originalCallFind) CallLead.find = originalCallFind;
  BookedLead.findById = originalBookingFindById;
  (BookingLeadReconciliationCase as unknown as MutableModel).exists = originalCaseExists;
  Link.findOne = originalLinkFindOne;
});

test("empty Connect q does not dump the book", async () => {
  stubBooking({ is_leadless_booking: true, is_referral_booking: false });
  stubOpenCase(false);
  const form = stubFind(bindForm(), [{ _id: formLeadId, name: "Should not appear" }]);
  stubFind(bindCall(), []);
  stubLink();

  const result = await listConnectLeadCandidates(String(bookingId), { limit: 25 });
  assert.deepEqual(result, { items: [], next_cursor: null });
  assert.equal(form.filter, undefined);
});

test("Connect Call q hits snapshot paths and excludes unmatched Call Leads", async () => {
  stubBooking({ is_leadless_booking: true, is_referral_booking: false });
  stubOpenCase(false);
  stubFind(bindForm(), []);
  const call = stubFind(bindCall(), [callLeadWithSnapshot()]);
  stubLink();

  const result = await listConnectLeadCandidates(String(bookingId), {
    q: "Granot-only Name",
    lead_model: "CallLead",
    limit: 25,
  });

  const preview = inspect(call.filter, { depth: null });
  assert.match(preview, /granot_contact_snapshot\.name/);
  assert.match(preview, /ingested_contact_snapshot\.name/);
  assert.match(preview, /created_on_unmatched/);
  assert.match(preview, /booked/);
  const projectionPreview = inspect(call.projection, { depth: null });
  assert.match(projectionPreview, /granot_contact_snapshot/);

  const item = result.items[0];
  assert.ok(item);
  assert.equal(item.contact.name, "Called Live");
  assert.equal(item.known_contacts?.form_submitted.name, "Called Live");
  assert.equal(item.known_contacts?.granot?.name, "Granot-only Name");
  assert.equal(item.known_contacts?.granot?.differs_from_ingested, true);
  assert.equal(JSON.stringify(item.known_contacts).includes("observation_id"), false);
});

test("Connect candidates fail closed on Referral, cancelled, and open-case Bookings", async () => {
  stubBooking({ is_leadless_booking: true, is_referral_booking: true });
  stubOpenCase(false);
  await assert.rejects(
    () => listConnectLeadCandidates(String(bookingId), { q: "Ada", limit: 25 }),
    (error: { code?: string }) => error.code === GRANOT_LIFECYCLE_ERROR_CODES.IDENTITY_CONFLICT,
  );

  stubBooking({ is_leadless_booking: true, cancelled: new Date(), is_referral_booking: false });
  await assert.rejects(
    () => listConnectLeadCandidates(String(bookingId), { q: "Ada", limit: 25 }),
    (error: { code?: string }) => error.code === GRANOT_LIFECYCLE_ERROR_CODES.IDENTITY_CONFLICT,
  );

  stubBooking({ is_leadless_booking: true, is_referral_booking: false });
  stubOpenCase(true);
  await assert.rejects(
    () => listConnectLeadCandidates(String(bookingId), { q: "Ada", limit: 25 }),
    (error: { code?: string }) => error.code === GRANOT_LIFECYCLE_ERROR_CODES.IDENTITY_CONFLICT,
  );
});

function bindForm(): MutableModel {
  if (!FormLead) {
    FormLead = getFormLeadModel() as unknown as MutableModel;
    originalFormFind = FormLead.find;
  }
  return FormLead;
}

function bindCall(): MutableModel {
  if (!CallLead) {
    CallLead = getCallLeadModel() as unknown as MutableModel;
    originalCallFind = CallLead.find;
  }
  return CallLead;
}

function stubBooking(doc: Record<string, unknown>): void {
  BookedLead.findById = (() => ({
    lean: () => ({
      exec: async () => ({ _id: bookingId, ...doc }),
    }),
  })) as typeof BookedLead.findById;
}

function stubOpenCase(open: boolean): void {
  (BookingLeadReconciliationCase as unknown as MutableModel).exists = async () =>
    open ? { _id: bookingId } : null;
}

function stubLink(): void {
  Link.findOne = (() => ({
    lean: () => ({
      exec: async () => null,
    }),
  })) as typeof Link.findOne;
}

function stubFind(model: MutableModel, docs: Record<string, unknown>[]): QueryCapture {
  const capture: QueryCapture = {};
  model.find = (filter: unknown) => {
    capture.filter = filter;
    return {
      select(projection: unknown) {
        capture.projection = projection;
        return this;
      },
      sort() {
        return this;
      },
      limit() {
        return this;
      },
      lean: async () => docs,
    };
  };
  return capture;
}

function callLeadWithSnapshot(): Record<string, unknown> {
  return {
    _id: callLeadId,
    name: "Called Live",
    first_name: "Called",
    last_name: "Live",
    phone_number: "555-0001",
    email: "called@example.invalid",
    granot_contact_snapshot: {
      name: "Granot-only Name",
      phone_number: "555-9999",
      differs_from_ingested: true,
      observation_id: toObjectId("64b7f4d9e6c2a1b0f3d5e799"),
      evidence_status: "qualified",
      captured_at: new Date("2026-08-01T12:00:00.000Z"),
    },
  };
}
