import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { requireApiSecret } from "../middleware/requireApiSecret";
import { createSalesIntelligenceBoundaryRouter } from "./sales-intelligence-boundary.routes";
import { computeAdminActorSignature } from "../services/operationsRegistry/trustedActor";

test(
  "real v1 guard + CSI boundary: Owner authority, and the retired scoped AI-run endpoints are refused",
  { timeout: 20000 },
  async () => {
    const fetch = (url: string, init: RequestInit) =>
      globalThis.fetch(url, { ...init, signal: AbortSignal.timeout(5000) });
    const saved = { ...process.env };
    const runId = randomBytes(12).toString("hex");
    process.env.VANTAGE_API_SECRET = "synthetic-global";
    process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET = "synthetic-owner-signature";
    // A deployment that still lists the retired run routes (and a broad route) for the old key.
    process.env.VANTAGE_SCOPED_API_KEYS = JSON.stringify([
      {
        name: "csi-agent",
        secret: "synthetic-scoped",
        routes: [
          { method: "GET", path: "/api/v1/form-leads" },
          { method: "GET", path: "/api/v1/internal/sales-intelligence/runs/:id/context" },
          { method: "POST", path: "/api/v1/internal/sales-intelligence/runs/:id/submit" },
        ],
      },
    ]);
    process.env.SALES_INTELLIGENCE_ENABLED = "true";
    process.env.SALES_INTELLIGENCE_SCOPED_KEY_NAME = "csi-agent";
    const app = express();
    app.use(express.json());
    app.use("/api/v1", requireApiSecret);
    app.use(createSalesIntelligenceBoundaryRouter());
    let reached = 0;
    const ownerPath = "/api/v1/admin/sales-intelligence/numbers";
    app.get(ownerPath, (_req, res) => { reached++; res.json({ ok: true }); });
    app.use((_req, res) => res.status(404).json({ ok: false, code: "NOT_FOUND" }));
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const ownerHeaders = (role = "owner") => {
      const fields = {
        adminId: "owner",
        email: "owner@example.test",
        role,
        timestamp: String(Date.now()),
        requestId: "request",
        method: "GET",
        path: ownerPath,
      };
      return {
        "x-api-secret": "synthetic-global",
        "x-vantage-admin-user-id": fields.adminId,
        "x-vantage-admin-email": fields.email,
        "x-vantage-admin-role": role,
        "x-vantage-admin-timestamp": fields.timestamp,
        "x-vantage-admin-request-id": fields.requestId,
        "x-vantage-admin-signature": computeAdminActorSignature(
          fields,
          process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET!,
        ),
      };
    };
    try {
      // The Sales Intelligence scoped key is refused everywhere, its old run routes included.
      for (const [method, path] of [
        ["GET", "/api/v1/form-leads"],
        ["GET", `/api/v1/internal/sales-intelligence/runs/${runId}/context`],
        ["POST", `/api/v1/internal/sales-intelligence/runs/${runId}/submit`],
      ] as const) {
        const response = await fetch(url + path, {
          method,
          headers: { "x-api-secret": "synthetic-scoped", "x-vantage-intelligence-run-token": "synthetic-token" },
        });
        assert.equal(response.status, 403, path);
        assert.equal(((await response.json()) as { code: string }).code, "RUN_SCOPE_DENIED");
      }
      // The broad secret finds no run endpoint: an old run submission has nothing to land on.
      const submit = await fetch(url + `/api/v1/internal/sales-intelligence/runs/${runId}/submit`, {
        method: "POST",
        headers: { "x-api-secret": "synthetic-global", "content-type": "application/json" },
        body: JSON.stringify({ findings: [] }),
      });
      assert.equal(submit.status, 404);
      assert.equal(
        (await fetch(url + `/api/v1/internal/sales-intelligence/runs/${runId}/context`, { headers: { "x-api-secret": "synthetic-global" } })).status,
        404,
      );

      // Owner boundary: the broad secret alone, the Admin role and the scoped key never reach an Owner route.
      assert.equal((await fetch(url + ownerPath, { headers: { "x-api-secret": "synthetic-global" } })).status, 403);
      assert.equal((await fetch(url + ownerPath, { headers: ownerHeaders("admin") })).status, 403);
      assert.equal((await fetch(url + ownerPath, { headers: { "x-api-secret": "synthetic-scoped" } })).status, 403);
      assert.equal(reached, 0);
      assert.equal((await fetch(url + ownerPath, { headers: ownerHeaders() })).status, 200);
      assert.equal((await fetch(url + ownerPath + "?scope=historical", { headers: ownerHeaders() })).status, 403);
      assert.equal(reached, 1);
      process.env.SALES_INTELLIGENCE_ENABLED = "false";
      assert.equal((await fetch(url + ownerPath, { headers: ownerHeaders() })).status, 404);
      assert.equal(reached, 1);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      process.env = saved;
    }
  },
);
