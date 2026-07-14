import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import mongoose from "mongoose";
import { MovingCarrier } from "../../models/MovingCarrier";
import {
  importMovingCarriersFromCsv,
  listMovingCarriers,
  normalizeCarrierName,
  parseMovingCarrierCsv,
} from "./movingCarrier.service";

type MutableModel = Record<string, unknown>;

const originalCreate = MovingCarrier.create as unknown;
const originalFind = MovingCarrier.find as unknown;
const originalFindOne = MovingCarrier.findOne as unknown;
const originalCountDocuments = MovingCarrier.countDocuments as unknown;

afterEach(() => {
  (MovingCarrier as unknown as MutableModel).create = originalCreate;
  (MovingCarrier as unknown as MutableModel).find = originalFind;
  (MovingCarrier as unknown as MutableModel).findOne = originalFindOne;
  (MovingCarrier as unknown as MutableModel).countDocuments = originalCountDocuments;
});

test("carrier normalization collapses whitespace and lowercases names", () => {
  assert.equal(normalizeCarrierName("  ATLANTIC   GROUP USA LLC  "), "atlantic group usa llc");
});

test("carrier CSV parser normalizes headers and rejects duplicate compound identities", () => {
  const parsed = parseMovingCarrierCsv(
    [
      "Carrier Name,DOT,MC",
      " ALL-ROADS   EXPRESS CORP ,1883785,679114",
      "Duplicate All Roads,1883785,679114",
      ",123,456",
    ].join("\n"),
  );

  assert.equal(parsed.totalRows, 3);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].name, "ALL-ROADS EXPRESS CORP");
  assert.equal(parsed.rows[0].dot_number, "1883785");
  assert.equal(parsed.rows[0].mc_number, "679114");
  assert.equal(parsed.skipped, 2);
  assert.equal(parsed.errors[0].message, "Duplicate carrier identity in CSV: DOT 1883785, MC 679114");
});

test("carrier list defaults to active rows and applies q across searchable fields", async () => {
  const capture: { filter?: Record<string, unknown> } = {};
  (MovingCarrier as unknown as MutableModel).find = (filter: Record<string, unknown>) => {
    capture.filter = filter;
    return queryChain([
      makeDoc({
        name: "ALL-ROADS EXPRESS CORP",
        normalized_name: "all-roads express corp",
        dot_number: "1883785",
        mc_number: "679114",
        active: true,
      }),
    ]);
  };
  (MovingCarrier as unknown as MutableModel).countDocuments = () => ({
    exec: async () => 1,
  });

  const result = await listMovingCarriers({
    q: "188",
    active: true,
    page: 1,
    limit: 100,
  });

  assert.equal(capture.filter?.active, true);
  assert.ok(Array.isArray(capture.filter?.$or));
  assert.equal(result.items[0].dot_number, "1883785");
});

test("patch import creates missing carriers and reactivates changed existing carriers", async () => {
  const docs = [
    makeDoc({
      name: "Old Name",
      normalized_name: "old name",
      dot_number: "1883785",
      mc_number: "679114",
      active: false,
    }),
  ];
  installImportModel(docs);

  const result = await importMovingCarriersFromCsv({
    mode: "patch",
    csv_text: [
      "Carrier Name,DOT,MC",
      "ALL-ROADS EXPRESS CORP,1883785,679114",
      "ALLSAFE RELOCATION LLC,3453793,1125199",
    ].join("\n"),
  });

  assert.equal(result.created, 1);
  assert.equal(result.updated, 1);
  assert.equal(result.deactivated, 0);
  assert.equal(docs.length, 2);
  assert.equal(docs[0].active, true);
  assert.equal(docs[0].name, "ALL-ROADS EXPRESS CORP");
});

test("replace import deactivates active carriers missing from the uploaded CSV", async () => {
  const docs = [
    makeDoc({
      name: "ALL-ROADS EXPRESS CORP",
      normalized_name: "all-roads express corp",
      dot_number: "1883785",
      mc_number: "679114",
      active: true,
    }),
    makeDoc({
      name: "Missing Carrier",
      normalized_name: "missing carrier",
      dot_number: "999",
      mc_number: "888",
      active: true,
    }),
  ];
  installImportModel(docs);

  const result = await importMovingCarriersFromCsv({
    mode: "replace",
    csv_text: ["Carrier Name,DOT,MC", "ALL-ROADS EXPRESS CORP,1883785,679114"].join("\n"),
  });

  assert.equal(result.deactivated, 1);
  assert.equal(docs[1].active, false);
});

function installImportModel(docs: FakeCarrierDoc[]) {
  (MovingCarrier as unknown as MutableModel).findOne = (filter: Record<string, unknown>) => ({
    exec: async () =>
      docs.find(
        (doc) => doc.dot_number === filter.dot_number && doc.mc_number === filter.mc_number,
      ) ?? null,
  });
  (MovingCarrier as unknown as MutableModel).find = (filter: Record<string, unknown>) =>
    queryChain(filter.active === true ? docs.filter((doc) => doc.active) : docs);
  (MovingCarrier as unknown as MutableModel).create = async (input: Record<string, unknown>) => {
    const doc = makeDoc(input);
    docs.push(doc);
    return doc;
  };
}

type FakeCarrierDoc = ReturnType<typeof makeDoc>;

function makeDoc(input: Record<string, unknown>) {
  return {
    _id: new mongoose.Types.ObjectId(),
    name: String(input.name ?? ""),
    normalized_name: String(input.normalized_name ?? ""),
    dot_number: String(input.dot_number ?? ""),
    mc_number: String(input.mc_number ?? ""),
    active: input.active === true,
    created_from: String(input.created_from ?? "test"),
    set(update: Record<string, unknown>) {
      Object.assign(this, update);
    },
    save: async () => undefined,
    toObject() {
      return { ...this };
    },
  };
}

function queryChain(result: unknown) {
  return {
    sort() {
      return this;
    },
    skip() {
      return this;
    },
    limit() {
      return this;
    },
    lean() {
      return this;
    },
    exec: async () => result,
  };
}
