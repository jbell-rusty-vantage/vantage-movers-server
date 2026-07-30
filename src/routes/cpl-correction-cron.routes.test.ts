import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import routes from "./cpl-correction-cron.routes";

const app = express();
app.use(routes);

let server: ReturnType<typeof app.listen>;
let baseUrl = "";
const originalCronSecret = process.env.CRON_SECRET;

before(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(() => {
  if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalCronSecret;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

test("CPL correction drain requires configured cron authentication", async () => {
  delete process.env.CRON_SECRET;
  const response = await fetch(`${baseUrl}/api/cron/cpl-corrections-drain`, {
    method: "POST",
  });
  assert.equal(response.status, 500);
});

test("CPL correction drain rejects an invalid cron secret", async () => {
  process.env.CRON_SECRET = "expected";
  const response = await fetch(`${baseUrl}/api/cron/cpl-corrections-drain`, {
    method: "POST",
    headers: { authorization: "Bearer wrong" },
  });
  assert.equal(response.status, 401);
});
