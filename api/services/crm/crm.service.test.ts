import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import mongoose from "mongoose";
import { FormLead, type FormLeadDocument } from "../../models/FormLead";
import { submitFormLeadToCrm } from "./crm.service";
import { CRM_FORM_LEAD_ENDPOINT } from "./crmConfig";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

type FetchCall = {
  input: Parameters<typeof fetch>[0];
  init: Parameters<typeof fetch>[1];
};

function stubFetch(
  responder: (call: FetchCall) => Promise<Response> | Response,
): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input, init) => {
    const call = { input, init } as FetchCall;
    calls.push(call);
    return responder(call);
  }) as typeof fetch;
  return calls;
}

function hydrateFormLead(
  overrides: Partial<FormLeadDocument> = {},
): FormLeadDocument {
  return FormLead.hydrate({
    _id: new mongoose.Types.ObjectId(),
    name: "Jane Customer",
    pickup_zip: "07030",
    destination_zip: "33139",
    email: "jane@example.com",
    phone_number: "555-111-2222",
    move_size: "2 Bedrooms",
    move_date: new Date(Date.UTC(2026, 4, 28)),
    lid: "LID-EXISTING",
    ...overrides,
  }) as FormLeadDocument;
}

test("submitFormLeadToCrm POSTs to the Granot lead gateway with the urlencoded payload", async () => {
  const lead = hydrateFormLead();
  const calls = stubFetch(() => new Response("OK", { status: 200 }));

  await submitFormLeadToCrm(lead);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, CRM_FORM_LEAD_ENDPOINT);
  assert.equal(calls[0].init?.method, "POST");
  assert.equal(
    (calls[0].init?.headers as Record<string, string>)?.["Content-Type"],
    "application/x-www-form-urlencoded",
  );
  const body = String(calls[0].init?.body ?? "");
  assert.match(body, /label=Main\+Site\+Forms/);
  assert.match(body, /firstname=Jane/);
  assert.match(body, /lastname=Customer/);
  assert.match(body, new RegExp(`leadno=${lead._id.toString()}`));
});

test("submitFormLeadToCrm reports ok=true with the response body and payload on HTTP 200", async () => {
  const lead = hydrateFormLead();
  stubFetch(() => new Response("Granot accepted lead 42", { status: 200 }));

  const result = await submitFormLeadToCrm(lead);

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.responseText, "Granot accepted lead 42");
  assert.equal(result.error, undefined);
  assert.equal(result.payload.leadno, lead._id.toString());
});

test("submitFormLeadToCrm reports ok=false with response body on HTTP error", async () => {
  const lead = hydrateFormLead();
  stubFetch(() => new Response("bad request", { status: 400 }));

  const result = await submitFormLeadToCrm(lead);

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.responseText, "bad request");
  assert.equal(result.error, undefined);
  assert.equal(result.payload.leadno, lead._id.toString());
});

test("submitFormLeadToCrm catches network errors and returns ok=false with status 0 and an error message", async () => {
  const lead = hydrateFormLead();
  stubFetch(() => {
    throw new Error("ECONNRESET");
  });

  const result = await submitFormLeadToCrm(lead);

  assert.equal(result.ok, false);
  assert.equal(result.status, 0);
  assert.equal(result.responseText, "");
  assert.equal(result.error, "ECONNRESET");
  assert.equal(result.payload.leadno, lead._id.toString());
});

test("submitFormLeadToCrm forwards companyLabel as the Granot label", async () => {
  const lead = hydrateFormLead();
  const calls = stubFetch(() => new Response("OK", { status: 200 }));

  const result = await submitFormLeadToCrm(lead, {
    companyLabel: "BestRelocation",
  });

  assert.equal(result.payload.label, "BestRelocation");
  const body = String(calls[0].init?.body ?? "");
  assert.match(body, /label=BestRelocation/);
});
