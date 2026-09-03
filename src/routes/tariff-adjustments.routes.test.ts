import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, test } from "node:test";
import express from "express";
import type {
  AppendTariffAdjustmentRowsResult,
  TariffAdjustmentRow,
} from "../services/tariff";
import { createTariffAdjustmentsRouter } from "./tariff-adjustments.routes";

const VALID_BODY = {
  rows: [
    {
      effective_date: "9/1/2026",
      pickup_zone: "22079",
      delivery_zone: "29671",
      service: "Linehaul",
      rule: "300 cf",
      new_rule: "$3.75 per cf",
      carrier: "C2C",
    },
    {
      effective_date: "9/1/2026",
      pickup_zone: "22079",
      delivery_zone: "29671",
      service: "Additional Services",
      rule: "Binding Estimate Fee",
      new_rule: "$956.25",
      carrier: "C2C",
    },
  ],
};

const appended: TariffAdjustmentRow[][] = [];
let appendImpl: (
  rows: TariffAdjustmentRow[],
) => Promise<AppendTariffAdjustmentRowsResult> = async (rows) => {
  appended.push(rows);
  return {
    spreadsheetId: "must-not-leak",
    tabName: "Master",
    appended: 2,
    updatedRange: "Master!A2:H3",
    rows: rows.map((row) => [
      "9/1/2026 12:00:00",
      row.effectiveDate,
      row.pickupZone,
      row.deliveryZone,
      row.service,
      row.rule,
      row.newRule,
      row.carrier,
    ]),
  };
};

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const role = req.header("x-test-role");
  if (role === "owner" || role === "employee" || role === "customer_service") {
    (req as express.Request & {
      vantageAuth?: { kind: "user"; userId: string; email: string; role: string };
    }).vantageAuth = {
      kind: "user",
      userId: "user-1",
      email: `${role}@example.invalid`,
      role,
    };
  } else if (role === "secret") {
    (req as express.Request & { vantageAuth?: { kind: "secret" } }).vantageAuth = {
      kind: "secret",
    };
  }
  next();
});
app.use(
  createTariffAdjustmentsRouter({
    appendRows: (rows) => appendImpl(rows),
    now: () => new Date(2026, 8, 1),
  }),
);

let baseUrl = "";
let server: ReturnType<typeof app.listen>;

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error?: Error) => (error ? reject(error) : resolve())),
  );
});

afterEach(() => {
  appended.length = 0;
  appendImpl = async (rows) => {
    appended.push(rows);
    return {
      spreadsheetId: "must-not-leak",
      tabName: "Master",
      appended: 2,
      updatedRange: "Master!A2:H3",
      rows: rows.map((row) => [
        "9/1/2026 12:00:00",
        row.effectiveDate,
        row.pickupZone,
        row.deliveryZone,
        row.service,
        row.rule,
        row.newRule,
        row.carrier,
      ]),
    };
  };
});

test("Owner can append two Tariff Adjustment rows", async () => {
  const response = await post(VALID_BODY, { "x-test-role": "owner" });
  const body = (await response.json()) as {
    ok: boolean;
    data: { appended: number; tab_name: string; rows: string[][]; spreadsheetId?: string };
  };

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.data.appended, 2);
  assert.equal(body.data.tab_name, "Master");
  assert.equal(body.data.spreadsheetId, undefined);
  assert.equal(JSON.stringify(body).includes("must-not-leak"), false);
  assert.equal(appended.length, 1);
  assert.equal(appended[0]?.length, 2);
  assert.equal(appended[0]?.[0]?.service, "Linehaul");
  assert.equal(appended[0]?.[1]?.service, "Additional Services");
});

test("Employee can append two Tariff Adjustment rows", async () => {
  const response = await post(VALID_BODY, { "x-test-role": "employee" });
  const body = (await response.json()) as { ok: boolean; data: { appended: number } };

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.data.appended, 2);
});

test("Customer Service can append two Tariff Adjustment rows", async () => {
  const response = await post(VALID_BODY, { "x-test-role": "customer_service" });
  const body = (await response.json()) as { ok: boolean; data: { appended: number } };

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.data.appended, 2);
});

test("x-api-secret actors can append two Tariff Adjustment rows", async () => {
  const response = await post(VALID_BODY, { "x-test-role": "secret" });
  assert.equal(response.status, 200);
});

test("rejects customer and job identifiers", async () => {
  const response = await post(
    { ...VALID_BODY, job_no: "P123" },
    { "x-test-role": "employee" },
  );
  const body = (await response.json()) as { ok: boolean; error: string };

  assert.equal(response.status, 400);
  assert.equal(body.ok, false);
  assert.equal(appended.length, 0);
});

test("stamps today's date when effective_date is omitted", async () => {
  const response = await post(
    {
      rows: VALID_BODY.rows.map(({ effective_date: _date, ...row }) => row),
    },
    { "x-test-role": "owner" },
  );

  assert.equal(response.status, 200);
  assert.equal(appended[0]?.[0]?.effectiveDate, "9/1/2026");
  assert.equal(appended[0]?.[1]?.effectiveDate, "9/1/2026");
});

async function post(body: unknown, headers: Record<string, string>) {
  return fetch(`${baseUrl}/api/v1/tariff-adjustments`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
