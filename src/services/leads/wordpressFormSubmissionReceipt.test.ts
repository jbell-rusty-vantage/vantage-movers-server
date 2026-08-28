import assert from "node:assert/strict";
import { test } from "node:test";
import {
  captureWordpressReceiptThenCreateLead,
  createMemoryWordpressReceiptStore,
  resolveWordpressSubmissionKey,
  wordpressReceiptWriteAuthorized,
} from "./wordpressFormSubmissionReceipt.js";

const NOW = new Date("2026-08-27T16:00:00.000Z");

test("receipt exists before Lead create on the authorized path", async () => {
  const order: string[] = [];
  const store = createMemoryWordpressReceiptStore({
    onInsert: () => {
      order.push("receipt");
    },
  });

  const result = await captureWordpressReceiptThenCreateLead({
    authorization: {
      ingestionOrigin: "wordpress_form",
      testMode: true,
      databaseName: "testvantagemovers",
    },
    submissionKey: "wp-sub-authorized-1",
    now: NOW,
    store,
    createLead: async () => {
      order.push("lead");
      return { leadId: "lead-wp-1" };
    },
  });

  assert.deepEqual(order, ["receipt", "lead"]);
  assert.ok(result.receipt);
  assert.equal(result.receipt.submission_key, "wp-sub-authorized-1");
  assert.equal(result.receipt.processing_status, "lead_created");
  assert.equal(result.receipt.lead_ref?.id, "lead-wp-1");
  assert.ok(result.receipt.received_at.getTime() <= NOW.getTime());
  assert.equal(result.createdLead, true);
  assert.equal(store.list().length, 1);
});

test("duplicates collapse on the idempotency key", async () => {
  const store = createMemoryWordpressReceiptStore();
  let creates = 0;

  const first = await captureWordpressReceiptThenCreateLead({
    authorization: {
      ingestionOrigin: "wordpress_form",
      testMode: true,
      databaseName: "testvantagemovers",
    },
    submissionKey: "wp-sub-dup-1",
    now: NOW,
    store,
    createLead: async () => {
      creates += 1;
      return { leadId: "lead-wp-dup" };
    },
  });

  const second = await captureWordpressReceiptThenCreateLead({
    authorization: {
      ingestionOrigin: "wordpress_form",
      testMode: true,
      databaseName: "testvantagemovers",
    },
    submissionKey: "wp-sub-dup-1",
    now: new Date("2026-08-27T16:05:00.000Z"),
    store,
    createLead: async () => {
      creates += 1;
      return { leadId: "lead-wp-dup-should-not-create" };
    },
  });

  assert.equal(creates, 1);
  assert.equal(store.list().length, 1);
  assert.equal(first.createdLead, true);
  assert.equal(second.createdLead, false);
  assert.equal(second.reusedLeadId, "lead-wp-dup");
  assert.equal(second.receipt?.id, first.receipt?.id);
  assert.equal(second.receipt?.received_at.toISOString(), NOW.toISOString());
});

test("unauthorized or keyless WordPress create does not write a receipt", async () => {
  const store = createMemoryWordpressReceiptStore();
  const createLead = async () => ({ leadId: "lead-wp-skip" });

  for (const authorization of [
    {
      ingestionOrigin: "wordpress_form" as const,
      testMode: false,
      databaseName: "testvantagemovers",
    },
    {
      ingestionOrigin: "wordpress_form" as const,
      testMode: true,
      databaseName: "vantagemovers",
    },
    {
      ingestionOrigin: "vantage_admin" as const,
      testMode: true,
      databaseName: "testvantagemovers",
    },
  ]) {
    const result = await captureWordpressReceiptThenCreateLead({
      authorization,
      submissionKey: "wp-sub-should-skip",
      now: NOW,
      store,
      createLead,
    });
    assert.equal(result.receipt, null);
  }

  const keyless = await captureWordpressReceiptThenCreateLead({
    authorization: {
      ingestionOrigin: "wordpress_form",
      testMode: true,
      databaseName: "testvantagemovers",
    },
    submissionKey: undefined,
    now: NOW,
    store,
    createLead,
  });
  assert.equal(keyless.receipt, null);
  assert.equal(store.list().length, 0);
});

test("unattached receipt refuses a second Lead create", async () => {
  const store = createMemoryWordpressReceiptStore();
  await store.insertReceived({
    submission_key: "wp-sub-unattached-1",
    received_at: NOW,
  });
  let created = false;

  await assert.rejects(
    () =>
      captureWordpressReceiptThenCreateLead({
        authorization: {
          ingestionOrigin: "wordpress_form",
          testMode: true,
          databaseName: "testvantagemovers",
        },
        submissionKey: "wp-sub-unattached-1",
        now: NOW,
        store,
        createLead: async () => {
          created = true;
          return { leadId: "lead-wp-second" };
        },
      }),
    /unattached/,
  );
  assert.equal(created, false);
  assert.equal(store.list().length, 1);
  assert.equal(store.list()[0]?.lead_ref, null);
});

test("attach failure does not leave a creatable second Lead", async () => {
  let creates = 0;
  const store = createMemoryWordpressReceiptStore();
  const failingAttach = {
    insertReceived: store.insertReceived.bind(store),
    findBySubmissionKey: store.findBySubmissionKey.bind(store),
    async attachLeadRef() {
      throw new Error("mongo attach failed");
    },
  };

  await assert.rejects(
    () =>
      captureWordpressReceiptThenCreateLead({
        authorization: {
          ingestionOrigin: "wordpress_form",
          testMode: true,
          databaseName: "testvantagemovers",
        },
        submissionKey: "wp-sub-attach-fail",
        now: NOW,
        store: failingAttach,
        createLead: async () => {
          creates += 1;
          return { leadId: "lead-wp-attach-fail" };
        },
      }),
    /receipt attach failed/,
  );
  assert.equal(creates, 1);
  assert.equal(store.list()[0]?.lead_ref, null);

  await assert.rejects(
    () =>
      captureWordpressReceiptThenCreateLead({
        authorization: {
          ingestionOrigin: "wordpress_form",
          testMode: true,
          databaseName: "testvantagemovers",
        },
        submissionKey: "wp-sub-attach-fail",
        now: NOW,
        store,
        createLead: async () => {
          creates += 1;
          return { leadId: "lead-wp-second" };
        },
      }),
    /unattached/,
  );
  assert.equal(creates, 1);
});

test("capture failure aborts Lead create", async () => {
  let created = false;
  await assert.rejects(
    () =>
      captureWordpressReceiptThenCreateLead({
        authorization: {
          ingestionOrigin: "wordpress_form",
          testMode: true,
          databaseName: "testvantagemovers",
        },
        submissionKey: "wp-sub-fail-closed",
        now: NOW,
        store: {
          async insertReceived() {
            throw new Error("mongo unavailable");
          },
          async findBySubmissionKey() {
            return null;
          },
          async attachLeadRef() {
            throw new Error("unreachable");
          },
        },
        createLead: async () => {
          created = true;
          return { leadId: "lead-wp-fail" };
        },
      }),
    /WordPress submission receipt capture failed/,
  );
  assert.equal(created, false);
});
