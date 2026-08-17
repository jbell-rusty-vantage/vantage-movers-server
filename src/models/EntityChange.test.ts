import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import {
  DELETED_ENTITY_CHANGE_PATH,
  ENTITY_CHANGE_COLLECTION,
  ENTITY_CHANGE_INDEXES,
  ENTITY_CHANGE_MODEL_NAME,
  ENTITY_CHANGE_SOURCE_SYSTEMS,
  ENTITY_CHANGE_VALUE_MODES,
  EntityChange,
  getEntityChangeModel,
} from "./EntityChange";

function change(overrides: Record<string, unknown> = {}) {
  return new EntityChange({
    entity: { model: "FormLead", id: "lead-1" },
    command_execution_id: new mongoose.Types.ObjectId(),
    command_name: "createFormLead",
    provenance: {
      source_system: "vantage",
      actor: {
        actor_type: "system",
        actor_id: "vantage-api-secret",
        actor_label: "Vantage API secret",
        actor_role: "system",
        request_id: "req-1",
        origin: "vantage_admin",
      },
      initiator: {
        actor_type: "system",
        actor_id: "vantage-api-secret",
        actor_label: "Vantage API secret",
        actor_role: "system",
        request_id: "req-1",
        origin: "vantage_admin",
      },
      request_id: "req-1",
    },
    changed_paths: ["quoted"],
    fields: [
      {
        path: "quoted",
        value_mode: "stored",
        before: false,
        after: true,
      },
    ],
    revision_before: 0,
    revision_after: 1,
    applied_at: new Date("2026-08-17T20:00:00.000Z"),
    ...overrides,
  });
}

test("[AC-32] EntityChange model uses the named collection and four exact indexes", () => {
  assert.equal(EntityChange.modelName, ENTITY_CHANGE_MODEL_NAME);
  assert.equal(EntityChange.collection.collectionName, ENTITY_CHANGE_COLLECTION);
  assert.equal(getEntityChangeModel().modelName, ENTITY_CHANGE_MODEL_NAME);
  assert.equal(ENTITY_CHANGE_INDEXES.length, 4);
  const indexes = EntityChange.schema.indexes() as Array<
    [Record<string, unknown>, Record<string, unknown>]
  >;
  for (const expected of ENTITY_CHANGE_INDEXES) {
    const declared = indexes.find(([, options]) => options.name === expected.name);
    assert.ok(declared, expected.name);
    assert.deepEqual(declared?.[0], expected.key);
    if ("unique" in expected) {
      assert.equal(declared?.[1].unique, true);
    }
  }
  assert.deepEqual(ENTITY_CHANGE_SOURCE_SYSTEMS, [
    "vantage",
    "granot",
    "ringcentral",
  ]);
  assert.deepEqual(ENTITY_CHANGE_VALUE_MODES, [
    "stored",
    "hashed",
    "reference_only",
  ]);
});

test("[AC-32] EntityChange requires adjacent nonnegative revisions and matching changed_paths", async () => {
  const document = change();
  await document.validate();
  await assert.rejects(change({ revision_before: -1 }).validate(), /revision_before/);
  await assert.rejects(
    change({ revision_before: 2, revision_after: 2 }).validate(),
    /revision_after/,
  );
  await assert.rejects(
    change({
      changed_paths: ["quoted", "quoted"],
      fields: [{ path: "quoted", value_mode: "stored", after: true }],
    }).validate(),
    /changed_paths/,
  );
  await assert.rejects(
    change({
      changed_paths: ["cubic_feet"],
      fields: [{ path: "quoted", value_mode: "stored", after: true }],
    }).validate(),
    /changed_paths|fields/,
  );
});

test("[AC-32] contact/address and delete fields are reference_only with no raw values", async () => {
  const contact = change({
    changed_paths: ["phone_number"],
    fields: [{ path: "phone_number", value_mode: "reference_only" }],
  });
  await contact.validate();
  await assert.rejects(
    change({
      changed_paths: ["phone_number"],
      fields: [
        {
          path: "phone_number",
          value_mode: "stored",
          after: "5550000011",
        },
      ],
    }).validate(),
    /reference_only|contact/i,
  );
  await assert.rejects(
    change({
      changed_paths: ["email"],
      fields: [{ path: "email", value_mode: "reference_only", after: "a@b.test" }],
    }).validate(),
    /reference_only/,
  );
  const deleted = change({
    changed_paths: [DELETED_ENTITY_CHANGE_PATH],
    fields: [{ path: DELETED_ENTITY_CHANGE_PATH, value_mode: "reference_only" }],
  });
  await deleted.validate();
  await assert.rejects(
    change({
      changed_paths: [DELETED_ENTITY_CHANGE_PATH],
      fields: [
        {
          path: DELETED_ENTITY_CHANGE_PATH,
          value_mode: "reference_only",
          before: { name: "hidden" },
        },
      ],
    }).validate(),
    /reference_only/,
  );
});

test("[AC-32] EntityChange serialization omits payload, headers, secrets, and unmasked contact", async () => {
  const document = change({
    changed_paths: ["phone_number", "quoted"],
    fields: [
      { path: "phone_number", value_mode: "reference_only" },
      { path: "quoted", value_mode: "stored", before: false, after: true },
    ],
  });
  await document.validate();
  const json = JSON.stringify(document.toObject());
  for (const forbidden of [
    "payload",
    "headers",
    "5550000011",
    "a@b.test",
    "authorization",
    "cookie",
  ]) {
    assert.equal(json.includes(forbidden), false, forbidden);
  }
});

test("[AC-32] EntityChange save and query hooks reject post-insert mutation", async () => {
  const document = change();
  document.isNew = false;
  await assert.rejects(document.save(), /write-once/);
  const id = new mongoose.Types.ObjectId();
  await assert.rejects(
    EntityChange.updateOne({ _id: id }, { $set: { command_name: "other" } }),
    /updated, replaced, or deleted/,
  );
  await assert.rejects(EntityChange.deleteOne({ _id: id }), /updated, replaced, or deleted/);
});
