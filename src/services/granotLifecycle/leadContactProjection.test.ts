import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { projectRoleSafeLeadContacts } from "./leadContactProjection";

test("[AC-10] WordPress submitted contact and Granot snapshot stay separately identifiable and masked", () => {
  const observationId = new mongoose.Types.ObjectId();
  const projection = projectRoleSafeLeadContacts({
    ingestion_origin: "wordpress_form",
    name: "Ada Lovelace",
    first_name: "Ada",
    last_name: "Lovelace",
    phone_number: "5550001111",
    email: "ada@example.test",
    granot_contact_snapshot: {
      name: "Ada Granot",
      first_name: "Ada",
      last_name: "Granot",
      phone_number: "5550002222",
      email: "granot@example.test",
      differs_from_ingested: true,
      observation_id: observationId,
      captured_at: new Date("2026-08-18T15:00:00.000Z"),
    },
  });
  assert.equal(projection.submitted_contact?.name, "Ada Lovelace");
  assert.equal(projection.submitted_contact?.phone_number, "***1111");
  assert.equal(projection.submitted_contact?.email, "a***@example.test");
  assert.equal(projection.granot_contact?.name, "Ada Granot");
  assert.equal(projection.granot_contact?.phone_number, "***2222");
  assert.equal(projection.granot_contact?.differs_from_ingested, true);
  assert.equal(projection.granot_contact?.observation_id, String(observationId));
  assert.equal(JSON.stringify(projection).includes("5550001111"), false);
  assert.equal(JSON.stringify(projection).includes("5550002222"), false);
  assert.equal(JSON.stringify(projection).includes("ada@example.test"), false);
});
