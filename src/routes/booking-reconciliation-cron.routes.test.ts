import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, test } from "node:test";
import express from "express";
import bookingReconciliationCronRoutes from "./booking-reconciliation-cron.routes";

const app = express();
app.use(express.json());
app.use(bookingReconciliationCronRoutes);

let baseUrl = "";
let server: ReturnType<typeof app.listen>;

const originalSecret = process.env.CRON_SECRET;
const originalEnabled =
  process.env.BOOKING_RECONCILIATION_AUTO_REMATCH_ENABLED;

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err?: Error) => (err ? reject(err) : resolve())),
  );
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
  if (originalEnabled === undefined) {
    delete process.env.BOOKING_RECONCILIATION_AUTO_REMATCH_ENABLED;
  } else {
    process.env.BOOKING_RECONCILIATION_AUTO_REMATCH_ENABLED = originalEnabled;
  }
});

test("booking reconciliation cron requires CRON_SECRET", async () => {
  delete process.env.CRON_SECRET;
  const res = await fetch(`${baseUrl}/api/cron/booking-reconciliation-rematch`, {
    method: "POST",
  });
  assert.equal(res.status, 500);
});

test("booking reconciliation cron rejects wrong secret", async () => {
  process.env.CRON_SECRET = "expected";
  const res = await fetch(`${baseUrl}/api/cron/booking-reconciliation-rematch`, {
    method: "POST",
    headers: { authorization: "Bearer wrong" },
  });
  assert.equal(res.status, 401);
});
