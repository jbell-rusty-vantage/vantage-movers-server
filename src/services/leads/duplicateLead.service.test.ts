import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import mongoose, { type ClientSession } from "mongoose";
import { reportingEligibleCallLeadFilter } from "./callLeadAdmission";
import {
  findDuplicateFormLeadMatch,
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

test("Form duplicate lookup uses exact granularity and the earlier-only cohort for its arrival", async () => {
  let findQuery: FindQuery | undefined;
  const scope = {
    sourceCompany: "tbm_leads",
    leadSourceCompany: new mongoose.Types.ObjectId(),
    sourceGranularityId: "granularity-3",
  };
  const eventTimestamp = new Date("2026-10-29T16:00:00.000Z");
  const cutoff = new Date("2026-04-30T04:00:00.000Z");
  stubFormLeadFind([], (query) => {
    findQuery = query;
  });

  const duplicate = await findDuplicateFormLeadMatch(
    scope,
    "9542340460",
    "customer@example.com",
    eventTimestamp,
  );

  assert.deepEqual(duplicate, { duplicate: false, matchedBy: null, matchedLeadIds: [] });
  assert.deepEqual(findQuery?.$and?.[0], { source_granularity_id: "granularity-3" });
  assert.deepEqual(findQuery?.$and?.[2]?.timestamp, { $gte: cutoff, $lt: eventTimestamp });

  const historicalArrival = new Date("2026-03-01T16:00:00.000Z");
  await findDuplicateFormLeadMatch(scope, null, "customer@example.com", historicalArrival);
  assert.deepEqual(findQuery?.$and?.[2]?.timestamp, { $lt: historicalArrival });
});

test("Form duplicate phone matching verifies normalized candidates", async () => {
  const scope = { sourceCompany: "best_relocation_leads", sourceGranularityId: "granularity-5" };
  stubFormLeadFind([{ phone_number: "56198899980" }]);
  assert.equal(await isDuplicateFormLead(scope, "5619889998", null), false);

  stubFormLeadFind([{ phone_number: "+1 (561) 988-9998" }]);
  assert.equal(await isDuplicateFormLead(scope, "5619889998", null), true);
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

  assert.deepEqual(findQuery?.$and?.[1], reportingEligibleCallLeadFilter());
  assert.deepEqual(findQuery?.$and?.[2], { form_fill: { $ne: true } });
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
