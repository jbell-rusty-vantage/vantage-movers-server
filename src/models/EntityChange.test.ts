import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { DELETED_ENTITY_CHANGE_PATH, EntityChange } from "./EntityChange";

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
