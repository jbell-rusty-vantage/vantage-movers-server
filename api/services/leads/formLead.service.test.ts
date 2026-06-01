import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { FormLead } from "../../models/FormLead";
import { ConflictError, NotFoundError } from "../errors";
import { findFormLead, updateFormLead } from "./formLead.service";

type StubbedFormLeadModel = {
  findById: (id: string) => unknown;
};

const originalFindById = FormLead.findById as unknown;

afterEach(() => {
  (FormLead as unknown as StubbedFormLeadModel).findById =
    originalFindById as StubbedFormLeadModel["findById"];
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

function stubFindById(document: Record<string, unknown> | null): void {
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
