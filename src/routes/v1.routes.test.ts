import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import router, { buildGranotSyncExpectedFilter } from "./v1.routes";

test("Call Lead creation is unavailable even with the global API secret", async (t) => {
  const savedSecret = process.env.VANTAGE_API_SECRET;
  process.env.VANTAGE_API_SECRET = "synthetic-lead-api";
  t.after(() => {
    if (savedSecret === undefined) delete process.env.VANTAGE_API_SECRET;
    else process.env.VANTAGE_API_SECRET = savedSecret;
  });

  const app = express();
  app.use(express.json(), router);
  app.use((_req, res) => { res.status(404).json({ missingRoute: true }); });
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()),
  ));
  await once(server, "listening");

  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  const request = {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-secret": "synthetic-lead-api" },
    body: "{}",
  };
  const unsigned = await fetch(`${base}/call-leads`, { method: "POST" });
  assert.equal(unsigned.status, 401);
  const call = await fetch(`${base}/call-leads`, request);
  assert.equal(call.status, 404);
  assert.deepEqual(await call.json(), { missingRoute: true });
});

test("Granot sync expected filter enforces fill-only and empty receiver fields", () => {
  assert.deepEqual(
    buildGranotSyncExpectedFilter(
      {
        pickup_city: "Miami",
        pickup_state: "FL",
        destination_zip: "33139",
        receiver_agent: "507f1f77bcf86cd799439011",
      },
      "top10_leads",
      {
        pickup_state: "FL",
        pickup_zip: null,
        receiver_agent: null,
      },
    ),
    {
      source_company: "top10_leads",
      duplicate: { $ne: true },
      pickup_state: "FL",
      pickup_zip: null,
      receiver_agent: null,
      $and: [
        { pickup_city: { $in: [null, ""] } },
        { pickup_state: { $in: [null, "", "not_found"] } },
        {
          $or: [
            { destination_zip: { $in: [null, ""] } },
            { destination_zip: { $regex: /^0+$/ } },
          ],
        },
        { receiver_agent: null },
      ],
    },
  );
});
