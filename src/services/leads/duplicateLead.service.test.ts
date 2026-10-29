import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import mongoose, { type ClientSession } from "mongoose";
import {
  findDuplicateFormLeadMatch,
  hasFormFillForCallLead,
  isDuplicateFormLead,
  markMatchingCallLeadsWithFormFill,
} from "./duplicateLead.service";

type FindQuery = {
  source_company?: string;
  duplicate?: unknown;
  $or?: Array<Record<string, unknown>>;
  $and?: Array<Record<string, unknown>>;
};

const originalUseDb = mongoose.connection.useDb;

afterEach(() => {
  mongoose.connection.useDb = originalUseDb;
});

test("form duplicate check matches an earlier lead by email within exact granularity", async () => {
  let findQuery: FindQuery | undefined;
  stubFormLeadFind(
    [
      {
        email: "customer@example.com",
        phone_number: "5551112222",
      },
    ],
    (query) => {
      findQuery = query;
    },
  );

  const duplicate = await isDuplicateFormLead(
    { sourceCompany: "tbm_leads", sourceGranularityId: "granularity-1" },
    "5553334444",
    " CUSTOMER@example.com ",
  );

  assert.equal(duplicate, true);
  assert.equal(findQuery?.$and?.[0]?.source_granularity_id, "granularity-1");
  assert.deepEqual(findQuery?.$and?.[1]?.duplicate, { $ne: true });
  assert.equal(
    (findQuery?.$and?.[3]?.$or as Array<Record<string, unknown>> | undefined)?.some(
      (clause) => clause.email === "customer@example.com",
    ),
    true,
  );
});

test("form duplicate check matches existing lead by phone within exact granularity", async () => {
  let findQuery: FindQuery | undefined;
  stubFormLeadFind(
    [
      {
        email: "other@example.com",
        phone_number: "+1 (561) 988-9998",
      },
    ],
    (query) => {
      findQuery = query;
    },
  );

  const duplicate = await isDuplicateFormLead(
    { sourceCompany: "main_site", sourceGranularityId: "granularity-2" },
    "5619889998",
    "new@example.com",
  );

  assert.equal(duplicate, true);
  assert.equal(findQuery?.$and?.[0]?.source_granularity_id, "granularity-2");
  assert.equal(
    (findQuery?.$and?.[3]?.$or as Array<Record<string, unknown>> | undefined)?.some(
      (clause) => clause.phone_number instanceof RegExp,
    ),
    true,
  );
});

test("form duplicate check does not fall back from exact granularity to company", async () => {
  let findQuery: FindQuery | undefined;
  const leadSourceCompany = new mongoose.Types.ObjectId();
  stubFormLeadFind([], (query) => {
    findQuery = query;
  });

  await isDuplicateFormLead(
    {
      sourceCompany: "tbm_leads",
      leadSourceCompany,
      sourceGranularityId: "granularity-3",
    },
    "9542340460",
    "dringram91231@gmail.com",
  );

  const sourceFilter = findQuery?.$and?.[0];
  const identifierFilter = findQuery?.$and?.[3];
  assert.equal(sourceFilter?.source_granularity_id, "granularity-3");
  assert.ok(identifierFilter?.$or);
  assert.equal(
    (identifierFilter?.$or as Array<Record<string, unknown>>).some(
      (clause) => clause.email === "dringram91231@gmail.com",
    ),
    true,
  );
});

test("form duplicate check allows single identifier duplicate matches", async () => {
  stubFormLeadFind([
    {
      email: "lead@example.com",
      phone_number: "5551112222",
    },
  ]);

  assert.equal(
    await isDuplicateFormLead({ sourceCompany: "top10_leads", sourceGranularityId: "granularity-4" }, null, "lead@example.com"),
    true,
  );
});

test("form duplicate check ignores regex candidates that fail exact phone verification", async () => {
  stubFormLeadFind([
    {
      email: "",
      phone_number: "56198899980",
    },
  ]);

  const duplicate = await isDuplicateFormLead(
    { sourceCompany: "best_relocation_leads", sourceGranularityId: "granularity-5" },
    "5619889998",
    "   ",
  );

  assert.equal(duplicate, false);
});

test("form duplicate check skips lookup when no usable identifier exists", async () => {
  let findCount = 0;
  stubFormLeadFind([], () => {
    findCount += 1;
  });

  assert.equal(
    await isDuplicateFormLead({ sourceCompany: "not_provided", sourceGranularityId: "granularity-6" }, null, "   "),
    false,
  );
  assert.equal(findCount, 0);
});

test("form duplicate check throws when contact exists without a source granularity", async () => {
  let findCount = 0;
  stubFormLeadFind([], () => {
    findCount += 1;
  });

  await assert.rejects(
    () =>
      isDuplicateFormLead(
        { sourceCompany: "tbm_leads", sourceGranularityId: "" },
        "5619889998",
        null,
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(
        error.message,
        "Duplicate Form Lead classification requires an exact Source Granularity",
      );
      return true;
    },
  );
  assert.equal(findCount, 0);
});

test("form duplicate check does not throw when contact and granularity are both absent", async () => {
  let findCount = 0;
  stubFormLeadFind([], () => {
    findCount += 1;
  });

  assert.equal(
    await isDuplicateFormLead(
      { sourceCompany: "tbm_leads", sourceGranularityId: "" },
      null,
      "   ",
    ),
    false,
  );
  assert.equal(findCount, 0);
});

test("form duplicate check excludes an equal timestamp", async () => {
  let findQuery: FindQuery | undefined;
  const eventTimestamp = new Date("2026-03-01T16:00:00.000Z");
  stubFormLeadFind([], (query) => {
    findQuery = query;
  });

  await isDuplicateFormLead(
    { sourceCompany: "tbm_leads", sourceGranularityId: "granularity-7" },
    null,
    "customer@example.com",
    eventTimestamp,
  );

  assert.deepEqual(findQuery?.$and?.[2]?.timestamp, { $lt: eventTimestamp });
});

test("form duplicate check uses only earlier leads before the cutoff", async () => {
  let findQuery: FindQuery | undefined;
  const eventTimestamp = new Date("2026-04-29T15:00:00.000Z");
  stubFormLeadFind([], (query) => {
    findQuery = query;
  });

  await findDuplicateFormLeadMatch(
    { sourceCompany: "tbm_leads", sourceGranularityId: "granularity-8" },
    null,
    "customer@example.com",
    eventTimestamp,
  );

  assert.deepEqual(findQuery?.$and?.[2]?.timestamp, { $lt: eventTimestamp });
});

test("form duplicate check keeps the post-cutoff cohort", async () => {
  let findQuery: FindQuery | undefined;
  const eventTimestamp = new Date("2026-10-29T16:00:00.000Z");
  const cutoff = new Date("2026-04-30T04:00:00.000Z");
  stubFormLeadFind([], (query) => {
    findQuery = query;
  });

  await findDuplicateFormLeadMatch(
    { sourceCompany: "tbm_leads", sourceGranularityId: "granularity-9" },
    null,
    "customer@example.com",
    eventTimestamp,
  );

  assert.deepEqual(findQuery?.$and?.[2]?.timestamp, {
    $gte: cutoff,
    $lt: eventTimestamp,
  });
});

test("form duplicate match reports email, phone, and both", async () => {
  const emailLeadId = new mongoose.Types.ObjectId();
  const phoneLeadId = new mongoose.Types.ObjectId();
  const bothLeadId = new mongoose.Types.ObjectId();

  stubFormLeadFind([
    {
      _id: emailLeadId,
      email: "customer@example.com",
      phone_number: "5551112222",
    },
  ]);
  assert.deepEqual(
    await findDuplicateFormLeadMatch(
      { sourceCompany: "tbm_leads", sourceGranularityId: "granularity-10" },
      null,
      " CUSTOMER@example.com ",
    ),
    {
      duplicate: true,
      matchedBy: "email",
      matchedLeadIds: [emailLeadId.toString()],
    },
  );

  stubFormLeadFind([
    {
      _id: phoneLeadId,
      email: "other@example.com",
      phone_number: "+1 (561) 988-9998",
    },
  ]);
  assert.deepEqual(
    await findDuplicateFormLeadMatch(
      { sourceCompany: "tbm_leads", sourceGranularityId: "granularity-11" },
      "5619889998",
      null,
    ),
    {
      duplicate: true,
      matchedBy: "phone",
      matchedLeadIds: [phoneLeadId.toString()],
    },
  );

  stubFormLeadFind([
    {
      _id: bothLeadId,
      email: "customer@example.com",
      phone_number: "5619889998",
    },
  ]);
  assert.deepEqual(
    await findDuplicateFormLeadMatch(
      { sourceCompany: "tbm_leads", sourceGranularityId: "granularity-12" },
      "5619889998",
      "customer@example.com",
    ),
    {
      duplicate: true,
      matchedBy: "both",
      matchedLeadIds: [bothLeadId.toString()],
    },
  );
});

test("form fill detection skips lookup when the phone cannot be normalized", async () => {
  let findCount = 0;
  stubFormLeadFind([], () => {
    findCount += 1;
  });

  assert.equal(await hasFormFillForCallLead("tbm_leads", null), false);
  assert.equal(await hasFormFillForCallLead("tbm_leads", "   "), false);
  assert.equal(await hasFormFillForCallLead("tbm_leads", "12345"), false);
  assert.equal(findCount, 0);
});

test("form fill detection matches lead source company or source company", async () => {
  let findQuery: FindQuery | undefined;
  const leadSourceCompany = new mongoose.Types.ObjectId();
  stubFormLeadFind(
    [{ phone_number: "(561) 988-9998" }],
    (query) => {
      findQuery = query;
    },
  );

  assert.equal(
    await hasFormFillForCallLead(
      { sourceCompany: "tbm_leads", leadSourceCompany },
      "5619889998",
    ),
    true,
  );

  assert.deepEqual(findQuery?.$and?.[0], {
    $or: [
      { lead_source_company: leadSourceCompany },
      { source_company: "tbm_leads" },
    ],
  });
  assert.deepEqual(findQuery?.$and?.[1]?.duplicate, { $ne: true });
  assert.ok(findQuery?.$and?.[2]?.phone_number instanceof RegExp);
});

test("form fill mark returns no jobs when the phone cannot be normalized", async () => {
  let findCount = 0;
  stubCallLeadMark([], () => {
    findCount += 1;
  });

  assert.deepEqual(
    await markMatchingCallLeadsWithFormFill("tbm_leads", "", "form-lead-1"),
    [],
  );
  assert.deepEqual(
    await markMatchingCallLeadsWithFormFill("tbm_leads", "12345", "form-lead-1"),
    [],
  );
  assert.equal(findCount, 0);
});

test("form fill mark shares one command execution and the caller session", async () => {
  let findQuery: FindQuery | undefined;
  const session = { id: "form-fill-txn" } as unknown as ClientSession;
  const first = fakeCallLead("5619889998");
  const second = fakeCallLead("+1 (561) 988-9998");
  const { changes, querySessions } = stubCallLeadMark([first, second], (query) => {
    findQuery = query;
  });

  const jobs = await markMatchingCallLeadsWithFormFill(
    "tbm_leads",
    "5619889998",
    "form-lead-2",
    session,
  );

  assert.deepEqual(findQuery?.$and?.[1], { form_fill: { $ne: true } });
  assert.deepEqual(findQuery?.$and?.[0], { source_company: "tbm_leads" });
  assert.deepEqual(querySessions, [session]);
  assert.equal(first.form_fill, true);
  assert.equal(second.form_fill, true);
  assert.deepEqual(
    jobs,
    [first, second].map((lead) => ({
      resource: "source_lead",
      operation: "call_lead.form_fill.update",
      leadModel: "CallLead",
      leadId: lead._id.toString(),
    })),
  );
  assert.equal(changes.length, 2);
  assert.equal(changes[0]?.data.command_name, "markCallLeadFormFill");
  assert.equal(changes[1]?.data.command_name, "markCallLeadFormFill");
  assert.equal(
    changes[0]?.data.command_execution_id.toString(),
    changes[1]?.data.command_execution_id.toString(),
  );
  assert.equal(changes[0]?.session, session);
  assert.equal(changes[1]?.session, session);
  assert.deepEqual(changes[0]?.data.changed_paths, ["form_fill"]);
  assert.deepEqual(changes[1]?.data.changed_paths, ["form_fill"]);
});

function stubFormLeadFind(
  leads: Array<{ _id?: mongoose.Types.ObjectId; email?: string; phone_number?: string }>,
  onFind?: (query: FindQuery) => void,
): void {
  const formLeadModel = {
    find: (query: FindQuery) => {
      onFind?.(query);
      return {
        sort: () => ({
          limit: () => ({ exec: async () => leads }),
          exec: async () => leads,
        }),
      };
    },
  };

  mongoose.connection.useDb = (() => ({
    models: { FormLead: formLeadModel },
    model: () => formLeadModel,
  })) as unknown as typeof mongoose.connection.useDb;
}

type SavedChange = {
  data: {
    command_name: string;
    command_execution_id: mongoose.Types.ObjectId;
    changed_paths: string[];
  };
  session: unknown;
};

type FakeCallLead = {
  _id: mongoose.Types.ObjectId;
  phone_number: string;
  form_fill: boolean;
  toObject: () => { _id: mongoose.Types.ObjectId; phone_number: string; form_fill: boolean };
  save: (options?: { session?: ClientSession }) => Promise<void>;
};

function fakeCallLead(phoneNumber: string): FakeCallLead {
  const id = new mongoose.Types.ObjectId();
  return {
    _id: id,
    phone_number: phoneNumber,
    form_fill: false,
    toObject() {
      return { _id: id, phone_number: phoneNumber, form_fill: false };
    },
    async save() {},
  };
}

function stubCallLeadMark(
  leads: FakeCallLead[],
  onFind?: (query: FindQuery) => void,
): { changes: SavedChange[]; querySessions: unknown[] } {
  const changes: SavedChange[] = [];
  const querySessions: unknown[] = [];
  const callLeadModel = {
    find: (query: FindQuery) => {
      onFind?.(query);
      const chain = {
        sort() {
          return chain;
        },
        limit() {
          return chain;
        },
        session(session: unknown) {
          querySessions.push(session);
          return chain;
        },
        exec: async () => leads,
      };
      return chain;
    },
    collection: {
      async findOne() {
        return { form_fill: true, domain_revision: 0 };
      },
      async updateOne() {
        return { matchedCount: 1 };
      },
    },
  };

  function FakeEntityChange(
    this: { save: (options?: { session?: ClientSession }) => Promise<void> },
    data: SavedChange["data"],
  ) {
    this.save = async (options) => {
      changes.push({ data, session: options?.session });
    };
  }

  mongoose.connection.useDb = (() => ({
    models: {
      CallLead: callLeadModel,
      EntityChange: FakeEntityChange,
    },
    model: (name: string) => (name === "EntityChange" ? FakeEntityChange : callLeadModel),
  })) as unknown as typeof mongoose.connection.useDb;

  return { changes, querySessions };
}
