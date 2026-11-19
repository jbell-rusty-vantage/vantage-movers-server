import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { getSalesOutreachConfigurationModel, salesOutreachConfigurationVersionKey } from "./configuration";
import { salesOutreachConfigurationValueSchema } from "../../validation/v1/salesOutreach";

const original = { ...process.env };
afterEach(() => {
  process.env = { ...original };
});

test("configuration documents are kind-checked; versions are insert-only and bulk writes are refused", async () => {
  const Configuration = getSalesOutreachConfigurationModel();
  const value = salesOutreachConfigurationValueSchema.parse({});
  const actor = { kind: "owner", id: "owner-1", request_id: "r1", run_id: null };
  const version = {
    kind: "version",
    key: salesOutreachConfigurationVersionKey("v1"),
    version: "v1",
    schema_version: 1,
    value,
    content_hash: "h",
    created_by: actor,
  };
  await new Configuration(version).validate();
  await assert.rejects(new Configuration({ ...version, key: "version:other" }).validate());
  await assert.rejects(new Configuration({ ...version, value: { controls: { desk_enabled: "yes" } } }).validate());
  const pointer = { kind: "pointer", key: "active", version: "v1", content_hash: "h", revision: 1, updated_by: "owner-1" };
  await new Configuration(pointer).validate();
  await assert.rejects(new Configuration({ ...pointer, revision: 0 }).validate());
  await assert.rejects(new Configuration({ ...pointer, key: "other" }).validate());
  await assert.rejects(new Configuration({ ...pointer, content_hash: null }).validate());
  await assert.rejects(new Configuration({ ...pointer, value }).validate());
  // Query guards run before any database access.
  await assert.rejects(Configuration.updateOne({ key: "version:v1" }, { $set: { content_hash: "x" } }).exec(), /immutable/);
  await assert.rejects(Configuration.deleteMany({}).exec(), /immutable/);
  await assert.rejects(Configuration.bulkWrite([]), /bulk mutation is forbidden/);
});
