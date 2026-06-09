import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import mongoose from "mongoose";
import { FormLead } from "../../models/FormLead";
import { ConflictError, NotFoundError } from "../errors";
import { findFormLead, updateFormLead } from "./formLead.service";

type StubbedFormLeadModel = {
  findById: (id: string) => unknown;
};

const originalFindById = FormLead.findById as unknown;
const originalUseDb = mongoose.connection.useDb;

afterEach(() => {
  (FormLead as unknown as StubbedFormLeadModel).findById =
    originalFindById as StubbedFormLeadModel["findById"];
  mongoose.connection.useDb = originalUseDb;
});

test("findFormLead returns not found for duplicate quarantine leads", async () => {
  stubFindById({
    _id: "6a19ddd4bf20b878123aac14",
    duplicate: true,
    quoted: false,
    cubic_feet: 100,
  });

  await assert.rejects(
    () => findFormLead("6a19ddd4bf20b878123aac14"),
    (error: unknown) => {
      assert.ok(error instanceof NotFoundError);
      assert.match(error.message, /not found/i);
      return true;
    },
  );
});

test("updateFormLead rejects quoted and cubic_feet updates on duplicate leads", async () => {
  const lead = {
    _id: "6a19ddd4bf20b878123aac14",
    duplicate: true,
    source_company: "top10_leads",
    local: "local",
    save: async () => lead,
  };

  stubFindById(lead);

  await assert.rejects(
    () => updateFormLead("6a19ddd4bf20b878123aac14", { quoted: true }),
    (error: unknown) => {
      assert.ok(error instanceof ConflictError);
      return true;
    },
  );
});

test("updateFormLead rejects bad_lead updates on duplicate, booked, or cancelled leads", async () => {
  for (const lead of [
    { duplicate: true, booked: undefined, cancelled: undefined },
    { duplicate: false, booked: "booking-id", cancelled: undefined },
    { duplicate: false, booked: undefined, cancelled: "cancel-id" },
  ]) {
    const document = {
      _id: "6a19ddd4bf20b878123aac14",
      source_company: "top10_leads",
      local: "local",
      save: async () => document,
      ...lead,
    };

    stubFindById(document);

    await assert.rejects(
      () =>
        updateFormLead("6a19ddd4bf20b878123aac14", {
          bad_lead: "auto_only",
        }),
      (error: unknown) => {
        assert.ok(error instanceof ConflictError);
        return true;
      },
    );
  }
});

function stubFindById(document: Record<string, unknown> | null): void {
  mongoose.connection.useDb = (() => ({
    models: { FormLead },
    model: () => FormLead,
  })) as unknown as typeof mongoose.connection.useDb;
  (FormLead as unknown as StubbedFormLeadModel).findById = () => {
    const query = {
      select: () => ({
        exec: async () => document,
        then: (resolve: (value: unknown) => void) => resolve(document),
      }),
    };

    if (document) {
      return {
        select: () => document,
        ...document,
      };
    }

    return query;
  };
}
