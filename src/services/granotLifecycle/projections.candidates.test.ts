import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { inspect } from "node:util";
import mongoose from "mongoose";
import { BookedLead } from "../../models/BookedLead";
import { getCallLeadModel } from "../../models/CallLead";
import { getFormLeadModel } from "../../models/FormLead";
import { getGranotBookingReconciliationCaseModel } from "../../models/GranotBookingReconciliationCase";
import {
  assembleCandidateEntries,
  callLeadCandidateSearchOr,
  formLeadCandidateSearchOr,
  listGranotLifecycleCaseCandidates,
  projectCandidateKnownContacts,
} from "./projections";

type MutableModel = {
  find: unknown;
  findById: unknown;
  exists?: unknown;
};

type QueryCapture = {
  filter?: unknown;
  projection?: unknown;
};

type CaseModelType = ReturnType<typeof getGranotBookingReconciliationCaseModel>;
type StubbableModel = {
  find: unknown;
  findById: unknown;
};

let FormLead: StubbableModel | undefined;
let CallLead: StubbableModel | undefined;
let CaseModel: CaseModelType | undefined;
let originalFormFind: unknown;
let originalFormFindById: unknown;
let originalCallFind: unknown;
let originalCallFindById: unknown;
let originalCaseFindById: CaseModelType["findById"] | undefined;
const originalExists = BookedLead.exists;

const sourceId = new mongoose.Types.ObjectId();
const granularityId = new mongoose.Types.ObjectId();
const observationId = new mongoose.Types.ObjectId();
const decisionId = new mongoose.Types.ObjectId();
const caseId = new mongoose.Types.ObjectId();
const formLeadId = new mongoose.Types.ObjectId();

afterEach(() => {
  if (FormLead && originalFormFind) FormLead.find = originalFormFind;
  if (FormLead && originalFormFindById) FormLead.findById = originalFormFindById;
  if (CallLead && originalCallFind) CallLead.find = originalCallFind;
  if (CallLead && originalCallFindById) CallLead.findById = originalCallFindById;
  if (CaseModel && originalCaseFindById) CaseModel.findById = originalCaseFindById;
  (BookedLead as unknown as MutableModel).exists = originalExists;
});

test("Form q for a Granot-only name includes granot_contact_snapshot.name", () => {
  const preview = inspect(formLeadCandidateSearchOr(/Granot-only Name/i), { depth: null });
  assert.match(preview, /granot_contact_snapshot\.name/);
  assert.match(preview, /Granot-only Name/);
});

test("Form q for an ingested-only email includes ingested_contact_snapshot.email", () => {
  const preview = inspect(formLeadCandidateSearchOr(/ingested-only@example.invalid/i), { depth: null });
  assert.match(preview, /ingested_contact_snapshot\.email/);
  assert.match(preview, /ingested-only@example\.invalid/);
});

test("Form q for a typed phone substring hits live and snapshot phone paths", () => {
  const preview = inspect(formLeadCandidateSearchOr(/555-1234/i), { depth: null });
  assert.match(preview, /phone_number/);
  assert.match(preview, /normalized_phone_number/);
  assert.match(preview, /ingested_contact_snapshot\.phone_number/);
  assert.match(preview, /ingested_contact_snapshot\.normalized_phone_number/);
  assert.match(preview, /granot_contact_snapshot\.phone_number/);
  assert.match(preview, /granot_contact_snapshot\.normalized_phone_number/);
  assert.match(preview, /555-1234/);
  assert.doesNotMatch(preview, /\\d\{0,2\}/);
});

test("Form q still hits job_no and ref_no", () => {
  const preview = inspect(formLeadCandidateSearchOr(/SYNTHJOB99/i), { depth: null });
  assert.match(preview, /job_no/);
  assert.match(preview, /ref_no/);
  assert.match(preview, /SYNTHJOB99/);
});

test("Call q still omits granot_contact_snapshot", () => {
  const preview = inspect(callLeadCandidateSearchOr(/Granot-only Name/i), { depth: null });
  assert.doesNotMatch(preview, /granot_contact_snapshot/);
  assert.doesNotMatch(preview, /ingested_contact_snapshot/);
  assert.match(preview, /Granot-only Name/);
});

test("empty q still pins ranked identity; explicit q still pins nothing", () => {
  const ranked = [
    { ref: { model: "FormLead" as const, id: "ranked-1" }, lead: { name: "Pinned" } },
  ];
  const browsed = [
    { ref: { model: "FormLead" as const, id: "browse-1" }, lead: { name: "Browse" } },
    { ref: { model: "FormLead" as const, id: "ranked-1" }, lead: { name: "Pinned again" } },
  ];

  assert.deepEqual(
    assembleCandidateEntries({}, ranked, browsed).map((row) => row.ref.id),
    ["ranked-1", "browse-1"],
  );
  assert.deepEqual(
    assembleCandidateEntries({ q: "Ada" }, ranked, browsed).map((row) => row.ref.id),
    ["browse-1", "ranked-1"],
  );
  assert.deepEqual(
    assembleCandidateEntries({ cursor: "opaque" }, ranked, browsed).map((row) => row.ref.id),
    ["browse-1", "ranked-1"],
  );
});

test("Form item with a snapshot returns known_contacts.granot and live contact stays Form submitted", () => {
  const known = projectCandidateKnownContacts({
    _id: formLeadId,
    name: "Form Submitted",
    first_name: "Form",
    last_name: "Submitted",
    phone_number: "555-0001",
    email: "form@example.invalid",
    granot_contact_snapshot: {
      name: "Granot Later",
      first_name: "Granot",
      last_name: "Later",
      phone_number: "555-9999",
      email: "granot@example.invalid",
      differs_from_ingested: true,
      observation_id: new mongoose.Types.ObjectId("64b7f4d9e6c2a1b0f3d5e799"),
      evidence_status: "qualified",
      captured_at: new Date("2026-08-01T12:00:00.000Z"),
    },
  });

  assert.equal(known.form_submitted.name, "Form Submitted");
  assert.equal(known.granot?.name, "Granot Later");
  assert.equal(known.granot?.differs_from_ingested, true);
  assert.equal(known.granot?.captured_at, "2026-08-01T12:00:00.000Z");
  assert.equal(JSON.stringify(known).includes("observation_id"), false);
  assert.equal(JSON.stringify(known).includes("64b7f4d9e6c2a1b0f3d5e799"), false);
  assert.equal(JSON.stringify(known).includes("evidence_status"), false);
});

test("Form item without a snapshot omits known_contacts.granot", () => {
  const known = projectCandidateKnownContacts({
    _id: formLeadId,
    name: "Form Submitted",
    first_name: "Form",
    last_name: "Submitted",
    phone_number: "555-0001",
    email: "form@example.invalid",
  });

  assert.equal(known.form_submitted.name, "Form Submitted");
  assert.equal("granot" in known, false);
});

test("listGranotLifecycleCaseCandidates Form q uses snapshot paths, excludes Duplicate/Bad, and maps known_contacts", async () => {
  const form = stubFind(bindForm(), [formLeadWithSnapshot()]);
  stubFind(bindCall(), []);
  stubCase();

  const result = await listGranotLifecycleCaseCandidates(String(caseId), {
    scope: "source",
    lead_model: "FormLead",
    q: "Granot Later",
    limit: 25,
  });

  const filterPreview = inspect(form.filter, { depth: null });
  assert.match(filterPreview, /granot_contact_snapshot\.name/);
  assert.match(filterPreview, /duplicate/);
  assert.match(filterPreview, /bad_lead/);
  const projectionPreview = inspect(form.projection, { depth: null });
  assert.match(projectionPreview, /granot_contact_snapshot/);
  assert.match(projectionPreview, /ingested_contact_snapshot/);

  const item = result?.items[0];
  assert.ok(item);
  assert.equal(item.contact.name, "Form Submitted");
  assert.equal(item.customer_label, "Form Submitted");
  assert.equal(item.known_contacts?.granot?.name, "Granot Later");
  assert.equal(item.known_contacts?.granot?.differs_from_ingested, true);
  assert.equal(JSON.stringify(item.known_contacts).includes("observation_id"), false);
});

test("listGranotLifecycleCaseCandidates Call q omits snapshot paths on the Call filter", async () => {
  stubFind(bindForm(), []);
  const call = stubFind(bindCall(), []);
  stubCase();

  await listGranotLifecycleCaseCandidates(String(caseId), {
    scope: "source",
    lead_model: "CallLead",
    q: "Granot-only Name",
    limit: 25,
  });

  const preview = inspect(call.filter, { depth: null });
  assert.doesNotMatch(preview, /granot_contact_snapshot/);
  assert.doesNotMatch(preview, /ingested_contact_snapshot/);
  const projectionPreview = inspect(call.projection, { depth: null });
  assert.doesNotMatch(projectionPreview, /granot_contact_snapshot/);
});

function bindForm(): StubbableModel {
  if (!FormLead) {
    FormLead = getFormLeadModel();
    originalFormFind = FormLead.find;
    originalFormFindById = FormLead.findById;
  }
  return FormLead;
}

function bindCall(): StubbableModel {
  if (!CallLead) {
    CallLead = getCallLeadModel();
    originalCallFind = CallLead.find;
    originalCallFindById = CallLead.findById;
  }
  return CallLead;
}

function stubCase(): void {
  if (!CaseModel) {
    CaseModel = getGranotBookingReconciliationCaseModel();
    originalCaseFindById = CaseModel.findById;
  }
  (CaseModel as unknown as MutableModel).findById = () => ({
    lean: async () => ({
      _id: caseId,
      mode: "create_missing_booking",
      normalized_job_no: "SYNTHJOB1",
      source_scope: {
        lead_source_company: sourceId,
        source_granularity_id: granularityId,
      },
      evidence: [{
        observation_id: observationId,
        decision_id: decisionId,
        captured_at: new Date("2020-01-01T00:00:00.000Z"),
        action: "booked",
      }],
      opened_at: new Date("2020-01-01T00:00:00.000Z"),
    }),
  });
  (BookedLead as unknown as MutableModel).exists = async () => null;
}

function stubFind(model: object, docs: Record<string, unknown>[]): QueryCapture {
  const capture: QueryCapture = {};
  (model as MutableModel).find = (filter: unknown) => {
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
  (model as MutableModel).findById = () => ({
    select() {
      return this;
    },
    lean: async () => null,
  });
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
    job_no: "SYNTHJOB1",
    normalized_job_no: "SYNTHJOB1",
    lead_source_company: sourceId,
    source_granularity_id: granularityId,
    source_company_label_snapshot: "Synthetic Source",
    source_granularity_label_snapshot: "Synthetic Form",
    ingested_contact_snapshot: {
      name: "Form Submitted",
      email: "form@example.invalid",
    },
    granot_contact_snapshot: {
      name: "Granot Later",
      first_name: "Granot",
      last_name: "Later",
      phone_number: "555-9999",
      email: "granot@example.invalid",
      differs_from_ingested: true,
      observation_id: new mongoose.Types.ObjectId("64b7f4d9e6c2a1b0f3d5e799"),
      evidence_status: "qualified",
      captured_at: new Date("2026-08-01T12:00:00.000Z"),
    },
  };
}
