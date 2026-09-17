import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { requireApiSecret } from "../middleware/requireApiSecret";
import { createSalesIntelligenceBoundaryRouter } from "./sales-intelligence-boundary.routes";
import { computeAdminActorSignature } from "../services/operationsRegistry/trustedActor";
import {
  verifyRunToken,
  signRunToken,
  type ActiveRunScope,
  type RunClaims,
} from "../services/salesIntelligence/auth";

test(
  "real v1 guard + CSI boundary keeps Owner and scoped service authority separate",
  { timeout: 20000 },
  async () => {
    const fetch = (url: string, init: RequestInit) =>
      globalThis.fetch(url, { ...init, signal: AbortSignal.timeout(5000) });
    const saved = { ...process.env };
    const runId = randomBytes(12).toString("hex");
    process.env.VANTAGE_API_SECRET = "synthetic-global";
    process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET =
      "synthetic-owner-signature";
    process.env.VANTAGE_SCOPED_API_KEYS = JSON.stringify([
      {
        name: "csi-agent",
        secret: "synthetic-scoped",
        routes: [
          { method: "GET", path: "/api/v1/form-leads" },
          {
            method: "GET",
            path: "/api/v1/internal/sales-intelligence/runs/:id/context",
          },
        ],
      },
    ]);
    process.env.SALES_INTELLIGENCE_ENABLED = "true";
    process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID = "route-test";
    process.env.TEST_MODE = "true";
    process.env.TEST_MONGO_DATABASE_NAME = "testvantagemovers_csiroute";
    process.env.SALES_INTELLIGENCE_SCOPED_KEY_NAME = "csi-agent";
    process.env.SALES_INTELLIGENCE_RUN_TOKEN_SECRET =
      "synthetic-run-key-for-route-test-32-plus";
    const now = Date.now();
    const active: ActiveRunScope = {
      id: runId,
      subject_key: "number:test",
      deployment: "route-test",
      database: "testvantagemovers_csiroute",
      status: "running",
      token_nonce: "synthetic-nonce-route",
      permitted_tools: ["get_intelligence_context"],
      lease_epoch: 1,
      leased_until: new Date(now + 60000),
    };
    const claims: RunClaims = {
      version: "csi-run-token-v1",
      run_id: runId,
      subject_key: active.subject_key,
      deployment: active.deployment,
      database: active.database,
      aud: "vantage-csi",
      nonce: active.token_nonce!,
      iat: Math.floor(now / 1000),
      exp: Math.floor(now / 1000) + 60,
      tools: ["get_intelligence_context"],
      lease_epoch: 1,
    };
    const token = signRunToken(claims, active);
    const app = express();
    app.use(express.json());
    app.use("/api/v1", requireApiSecret);
    let authorized = 0;
    app.use(
      createSalesIntelligenceBoundaryRouter({
        connect: async () => {},
        run: async (req, id, tool) => {
          const principal = (
            req as typeof req & {
              vantageAuth?: Parameters<typeof verifyRunToken>[1];
            }
          ).vantageAuth;
          verifyRunToken(
            req.header("x-vantage-intelligence-run-token") ?? "",
            principal,
            active,
            tool,
          );
          assert.equal(id, active.id);
          authorized++;
          return {
            claims,
            actor: {
              kind: "intelligence",
              id: "run",
              request_id: "request",
              run_id: runId,
            },
          };
        },
      }),
    );
    app.use((_req, res) => res.json({ ok: true }));
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const internal = `/api/v1/internal/sales-intelligence/runs/${runId}/context`;
    const ownerPath = "/api/v1/admin/sales-intelligence/overview";
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
      assert.equal(
        (
          await fetch(url + "/api/v1/form-leads", {
            headers: { "x-api-secret": "synthetic-scoped" },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await fetch(url + internal, {
            headers: { "x-vantage-intelligence-run-token": token },
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await fetch(url + internal, {
            headers: {
              "x-api-secret": "synthetic-global",
              "x-vantage-intelligence-run-token": token,
            },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await fetch(url + internal, {
            headers: { "x-api-secret": "synthetic-scoped" },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await fetch(url + internal, {
            headers: {
              "x-api-secret": "synthetic-scoped",
              "x-vantage-intelligence-run-token": token,
            },
          })
        ).status,
        200,
      );
      assert.equal(authorized, 1);
      const secondId = randomBytes(12).toString("hex");
      active.id = secondId;
      const secondToken = signRunToken({ ...claims, run_id: secondId }, active);
      const secondPath = `/api/v1/internal/sales-intelligence/runs/${secondId}/context`;
      assert.equal(
        (
          await fetch(url + secondPath, {
            headers: {
              "x-api-secret": "synthetic-scoped",
              "x-vantage-intelligence-run-token": secondToken,
            },
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await fetch(url + secondPath, {
            headers: {
              "x-api-secret": "synthetic-scoped",
              "x-vantage-intelligence-run-token": token,
            },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await fetch(
            url +
              `/api/v1/internal/sales-intelligence/runs/${secondId}/submission`,
            {
              headers: {
                "x-api-secret": "synthetic-scoped",
                "x-vantage-intelligence-run-token": secondToken,
              },
            },
          )
        ).status,
        403,
      ); // Not in this key's configured route list.
      assert.equal(
        (
          await fetch(url + ownerPath, {
            headers: { "x-api-secret": "synthetic-global" },
          })
        ).status,
        403,
      );
      assert.equal(
        (await fetch(url + ownerPath, { headers: ownerHeaders("admin") }))
          .status,
        403,
      );
      assert.equal(
        (await fetch(url + ownerPath, { headers: ownerHeaders() })).status,
        200,
      );
      assert.equal(
        (
          await fetch(url + ownerPath + "?scope=historical", {
            headers: ownerHeaders(),
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await fetch(url + ownerPath, {
            headers: { "x-api-secret": "synthetic-scoped" },
          })
        ).status,
        403,
      );
      process.env.SALES_INTELLIGENCE_ENABLED = "false";
      assert.equal(
        (await fetch(url + ownerPath, { headers: ownerHeaders() })).status,
        404,
      );
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      process.env = saved;
    }
  },
);
