import assert from "node:assert/strict";
import { after, test } from "node:test";
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { connectMongo } from "../../db";
import { BookedLead } from "../../models/BookedLead";
import { DomainCommandExecution } from "../../models/DomainCommandExecution";
import { EntityChange } from "../../models/EntityChange";
import { getFormLeadModel } from "../../models/FormLead";
import { SheetSyncJob } from "../../models/SheetSyncJob";
import { persistEntityChangeMutations } from "./entityChange";
import { createVantageApiSecretActor } from "./existingWriteContext";
import {
  runExistingUpdateBookedLead,
  runExistingUpdateSourceOwnedLead,
} from "./existingWrites";
import { executeCanonicalCommandWithPostCommit } from "./idempotency";
import type { CanonicalCommandContext } from "./types";

async function replicaReady(t: { skip: (reason: string) => void }): Promise<boolean> {
  if (process.env.GRANOT_LIFECYCLE_REPLICA_TESTS !== "true") {
    t.skip("Replica-set proof is opt-in via GRANOT_LIFECYCLE_REPLICA_TESTS=true.");
    return false;
  }
  if (getMongoDatabaseName() !== "testvantagemovers") {
    t.skip("Replica-set proof requires TEST_MODE=true before process start.");
    return false;
  }
  await connectMongo();
  if (mongoose.connection.db?.databaseName !== "testvantagemovers") {
    t.skip("Refusing replica-set proof against a non-test database.");
    return false;
  }
  const hello = await mongoose.connection.db?.admin().command({ hello: 1 });
  if (!hello || hello.setName == null) {
    t.skip("Connected Mongo is not a replica set.");
    return false;
  }
  return true;
}

after(async () => {
  await mongoose.disconnect().catch(() => undefined);
});

function existingContext(prefix: string, checksum: string): CanonicalCommandContext {
  const requestId = `${prefix}-req`;
  const actor = createVantageApiSecretActor(requestId);
  return {
    command_id: new mongoose.Types.ObjectId().toHexString(),
    idempotency_key: `${prefix}-key`,
    payload_checksum: checksum,
    actor,
    initiator: actor,
    provenance: {
      origin: "vantage_admin",
      run_id: null,
      source_receipt_id: null,
      source_connection_key: null,
    },
  };
}

test("[AC-21] [AC-32] replica existing write commits Command/Change/revision/outbox; replay and rollback do not", async (t) => {
  if (!(await replicaReady(t))) return;
  const previousMode = process.env.SHEET_SYNC_MODE;
  process.env.SHEET_SYNC_MODE = "queued";
  t.after(() => {
    if (previousMode === undefined) delete process.env.SHEET_SYNC_MODE;
    else process.env.SHEET_SYNC_MODE = previousMode;
  });
  const prefix = `u11-${Date.now()}`;
  const FormLead = getFormLeadModel();
  const lead = await FormLead.create({
    name: "U11 Synthetic",
    phone_number: "5550000011",
    pickup_zip: "10001",
    destination_zip: "94105",
    move_size: "Studio",
    local: "long_distance",
    source_company: "main_site",
    lead_source_company: new mongoose.Types.ObjectId(),
    quoted: false,
    ref_no: prefix,
    domain_revision: 0,
  });
  const leadId = lead._id.toString();
  const updateContext = existingContext(`${prefix}-upd`, "a".repeat(64));
  const first = await runExistingUpdateSourceOwnedLead({
    lead_model: "FormLead",
    lead_id: leadId,
    patch: { quoted: true },
    context: updateContext,
  });
  assert.equal(first.command.status, "applied");
  const afterFirst = await FormLead.findById(leadId).lean();
  const changes = await EntityChange.find({ "entity.id": leadId }).lean();
  const commands = await DomainCommandExecution.find({
    command_id: updateContext.command_id,
  }).lean();
  const jobs = await SheetSyncJob.find({ entity_id: leadId }).lean();
  assert.equal(changes.length, 1);
  assert.equal(commands.length, 1);
  assert.equal(afterFirst?.domain_revision, 1);
  assert.equal(afterFirst?.quoted, true);
  assert.equal(String(afterFirst?.last_change_id), String(changes[0]?._id));
  assert.equal(String(changes[0]?.command_execution_id), String(commands[0]?._id));
  assert.ok((jobs?.length ?? 0) >= 1);
  assert.equal(JSON.stringify(changes[0]).includes("5550000011"), false);

  const replay = await runExistingUpdateSourceOwnedLead({
    lead_model: "FormLead",
    lead_id: leadId,
    patch: { quoted: true },
    context: updateContext,
  });
  assert.equal(replay.command.status, "already_applied");
  assert.equal((await EntityChange.find({ "entity.id": leadId }).lean()).length, 1);
  assert.equal(
    (await DomainCommandExecution.find({ command_id: updateContext.command_id }).lean())
      .length,
    1,
  );

  const noop = await runExistingUpdateSourceOwnedLead({
    lead_model: "FormLead",
    lead_id: leadId,
    patch: { quoted: true },
    context: existingContext(`${prefix}-noop`, "b".repeat(64)),
  });
  assert.equal(noop.command.status, "applied");
  assert.equal((await EntityChange.find({ "entity.id": leadId }).lean()).length, 1);
  assert.equal((await FormLead.findById(leadId).lean())?.domain_revision, 1);

  const booking = await BookedLead.create({
    book_date: new Date("2026-08-17T12:00:00.000Z"),
    job_no: `${prefix}-job`,
    lead_ref: leadId,
    lead_model: "FormLead",
    agent_allocations: [
      {
        agent: new mongoose.Types.ObjectId(),
        agent_name_snapshot: "Synthetic Agent",
        binder_amount: 100,
      },
    ],
    total_binder_amount: 100,
    deposit_amount: 50,
    merchant: "Synthetic Merchant",
    source: "main_site",
    domain_revision: 0,
  });
  const bookingUpdate = await runExistingUpdateBookedLead({
    booking_id: booking._id.toString(),
    patch: { deposit_amount: 75 },
    context: existingContext(`${prefix}-book`, "c".repeat(64)),
  });
  assert.equal(bookingUpdate.command.status, "applied");
  const bookingAfter = await BookedLead.findById(booking._id).lean();
  assert.equal(bookingAfter?.domain_revision, 1);
  const bookingChanges = await EntityChange.find({
    "entity.model": "BookedLead",
    "entity.id": booking._id.toString(),
  }).lean();
  assert.equal(bookingChanges.length, 1);
  assert.equal(JSON.stringify(bookingChanges[0]).includes("5550000011"), false);

  const beforeRollback = await FormLead.findById(leadId).lean();
  const leadChangesBeforeRollback = (
    await EntityChange.find({ "entity.id": leadId }).lean()
  ).length;
  const rollbackContext = existingContext(`${prefix}-rb`, "d".repeat(64));
  await assert.rejects(
    executeCanonicalCommandWithPostCommit({
      command_name: "updateSourceOwnedLead",
      context: rollbackContext,
      operation: async (tx) => {
        await persistEntityChangeMutations({
          session: tx.session,
          now: tx.now,
          command_name: "updateSourceOwnedLead",
          command_execution_id: tx.command_execution_id,
          context: rollbackContext,
          mutations: [
            {
              change_id: new mongoose.Types.ObjectId(),
              entity: { model: "FormLead", id: leadId },
              revision_before: Number(beforeRollback?.domain_revision ?? 0),
              fields: [{ path: "quoted", after: false }],
            },
          ],
        });
        throw new Error("injected after Change persist");
      },
    }),
    /injected after Change persist/,
  );
  assert.equal(
    (await EntityChange.find({ "entity.id": leadId }).lean()).length,
    leadChangesBeforeRollback,
  );
  assert.equal(
    (await FormLead.findById(leadId).lean())?.domain_revision,
    beforeRollback?.domain_revision,
  );
  assert.equal(
    (await DomainCommandExecution.find({ command_id: rollbackContext.command_id }).lean())
      .length,
    0,
  );

  await FormLead.deleteMany({ ref_no: prefix });
  await BookedLead.deleteMany({ job_no: `${prefix}-job` });
  await mongoose.connection.db?.collection("entity_changes").deleteMany({
    $or: [{ "entity.id": leadId }, { "entity.id": booking._id.toString() }],
  });
  await DomainCommandExecution.deleteMany({
    idempotency_key: new RegExp(`^${prefix}`),
  });
  await SheetSyncJob.deleteMany({
    $or: [{ entity_id: leadId }, { entity_id: booking._id.toString() }],
  });
});
