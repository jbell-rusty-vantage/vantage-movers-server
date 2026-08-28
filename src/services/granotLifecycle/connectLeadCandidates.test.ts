import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { inspect } from "node:util";
import mongoose from "mongoose";
import { BookedLead } from "../../models/BookedLead";
import { getCallLeadModel } from "../../models/CallLead";
import { getFormLeadModel } from "../../models/FormLead";
import { getGranotRecordLinkModel } from "../../models/GranotRecordLink";
import { GRANOT_LIFECYCLE_ERROR_CODES } from "./errors";
import { listConnectLeadCandidates } from "./projections";

type MutableModel = {
  find: unknown;
  findById: unknown;
  findOne?: unknown;
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
const Link = getGranotRecordLinkModel() as unknown as MutableModel;
const originalLinkFindOne = Link.findOne;

const bookingId = new mongoose.Types.ObjectId();
const formLeadId = new mongoose.Types.ObjectId();

afterEach(() => {
  if (FormLead && originalFormFind) FormLead.find = originalFormFind;
  if (CallLead && originalCallFind) CallLead.find = originalCallFind;
  BookedLead.findById = originalBookingFindById;
  Link.findOne = originalLinkFindOne;
});

test("empty Connect q does not dump the book", async () => {
  stubBooking({ is_leadless_booking: true, is_referral_booking: false });
  const form = stubFind(bindForm(), [{ _id: formLeadId, name: "Should not appear" }]);
  stubFind(bindCall(), []);
  stubLink();

  const result = await listConnectLeadCandidates(String(bookingId), { limit: 25 });
  assert.deepEqual(result, { items: [], next_cursor: null });
  assert.equal(form.filter, undefined);
});

test("Connect Form q hits snapshot paths and omits ineligible Leads", async () => {
  stubBooking({ is_leadless_booking: true, is_referral_booking: false, source: "best-relocation" });
  const form = stubFind(bindForm(), [formLeadWithSnapshot()]);
  stubFind(bindCall(), []);
  stubLink();

  const result = await listConnectLeadCandidates(String(bookingId), {
    q: "Granot Later",
    limit: 25,
  });

  const filterPreview = inspect(form.filter, { depth: null });
  assert.match(filterPreview, /granot_contact_snapshot\.name/);
  assert.match(filterPreview, /duplicate/);
  assert.match(filterPreview, /bad_lead/);
  assert.match(filterPreview, /booked/);
  assert.match(filterPreview, /cancelled/);
  const projectionPreview = inspect(form.projection, { depth: null });
  assert.match(projectionPreview, /granot_contact_snapshot/);

  const item = result.items[0];
  assert.ok(item);
  assert.equal(item.contact.name, "Form Submitted");
  assert.equal(item.known_contacts?.granot?.name, "Granot Later");
  assert.equal(item.known_contacts?.granot?.differs_from_ingested, true);
  assert.equal(JSON.stringify(item.known_contacts).includes("observation_id"), false);
});

test("Connect Call q omits snapshot paths and excludes unmatched Call Leads", async () => {
  stubBooking({ is_leadless_booking: true, is_referral_booking: false });
  stubFind(bindForm(), []);
  const call = stubFind(bindCall(), []);
  stubLink();

  await listConnectLeadCandidates(String(bookingId), {
    q: "Granot-only Name",
    lead_model: "CallLead",
    limit: 25,
  });

  const preview = inspect(call.filter, { depth: null });
  assert.doesNotMatch(preview, /granot_contact_snapshot/);
  assert.match(preview, /created_on_unmatched/);
  assert.match(preview, /booked/);
});

test("Connect candidates fail closed on Referral and cancelled Bookings", async () => {
  stubBooking({ is_leadless_booking: true, is_referral_booking: true });
  await assert.rejects(
    () => listConnectLeadCandidates(String(bookingId), { q: "Ada", limit: 25 }),
    (error: { code?: string }) => error.code === GRANOT_LIFECYCLE_ERROR_CODES.IDENTITY_CONFLICT,
  );

  stubBooking({ is_leadless_booking: true, cancelled: new Date(), is_referral_booking: false });
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

function formLeadWithSnapshot(): Record<string, unknown> {
  return {
    _id: formLeadId,
    name: "Form Submitted",
    first_name: "Form",
    last_name: "Submitted",
    phone_number: "555-0001",
    email: "form@example.invalid",
    source_company: "best-relocation",
    granot_contact_snapshot: {
      name: "Granot Later",
      differs_from_ingested: true,
      observation_id: new mongoose.Types.ObjectId("64b7f4d9e6c2a1b0f3d5e799"),
      evidence_status: "qualified",
      captured_at: new Date("2026-08-01T12:00:00.000Z"),
    },
  };
}
