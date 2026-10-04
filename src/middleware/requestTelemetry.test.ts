import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("request telemetry and auth decisions stay in structured logs without secrets", () => {
  // A separate process captures the real stdout JSON log stream. Database
  // credentials are omitted, so no Mongo connection can be attempted.
  const result = spawnSync(process.execPath, ["--import", "tsx", "--eval", `
    const assert = require('node:assert/strict');
    const { requireApiSecret } = require('./src/middleware/requireApiSecret.ts');
    const { httpLogger } = require('./src/middleware/httpLogger.ts');
    const http = require('node:http');
    async function auth(secret, path) {
      let status, nextCalled = false;
      const req = { method: 'GET', originalUrl: path, url: path,
        headers: {}, header: (name) => name === 'x-api-secret' ? secret : undefined };
      const res = { status(code) { status = code; return this; }, json() { return this; } };
      await requireApiSecret(req, res, () => { nextCalled = true; });
      return { status, nextCalled, context: req.vantageAuth };
    }
    (async () => {
      const accepted = await auth('scoped-secret', '/allowed');
      assert.equal(accepted.nextCalled, true);
      assert.equal(accepted.context.kind, 'scoped_key');
      assert.equal((await auth('scoped-secret', '/forbidden')).status, 403);
      assert.equal((await auth('wrong-secret', '/allowed')).status, 401);
      assert.equal((await auth(undefined, '/allowed')).status, 401);
      const server = http.createServer((req, res) => {
        httpLogger(req, res);
        setTimeout(() => { res.statusCode = req.url === '/failed' ? 503 : 200; res.end('done'); }, 15);
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      try {
        const base = 'http://127.0.0.1:' + server.address().port;
        assert.equal((await fetch(base + '/slow')).status, 200);
        assert.equal((await fetch(base + '/failed')).status, 503);
      } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
      }
      // Exercise the real v1 error handler. Missing Mongo configuration fails
      // locally before any connection attempt, and must still log its 5xx.
      process.env.VANTAGE_API_SECRET = 'global-test-secret';
      const express = require('express');
      const app = express();
      const router = require('./src/routes/v1.routes.ts').default;
      // Some route dependencies load dotenv while importing. Clear any loaded
      // URI before invoking the handler; its failure must be entirely offline.
      delete process.env.MONGO_URI;
      const path = '/api/v1/admin/catalog/agents';
      const route = router.stack.find(layer => layer.route?.path === path);
      assert.ok(route, 'real catalog route is registered');
      app.get(path, route.route.stack[0].handle);
      const api = app.listen(0, '127.0.0.1');
      await new Promise(resolve => api.once('listening', resolve));
      try {
        const response = await fetch('http://127.0.0.1:' + api.address().port + '/api/v1/admin/catalog/agents', {
          headers: { 'x-api-secret': 'global-test-secret' }
        });
        assert.equal(response.status, 500);
      } finally {
        api.closeAllConnections();
        await new Promise(resolve => api.close(resolve));
      }
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 60_000,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEST_MODE: "true",
      MONGO_URI: "",
      NODE_ENV: "production",
      VANTAGE_SCOPED_API_KEYS: JSON.stringify([{ name: "test-key", secret: "scoped-secret", routes: [{ method: "GET", path: "/allowed" }] }]),
    },
  });
  assert.equal(result.status, 0, result.stderr || `${result.error}\n${result.stdout}`);
  const logs = result.stdout
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line));
  assert.equal(logs.filter((log) => log.msg === "auth.scoped_key.accepted").length, 1);
  assert.deepEqual(
    logs
      .filter((log) => log.workflow === "api_secret" && log.msg !== "auth.scoped_key.accepted")
      .map((log) => [log.msg, log.level]),
    [
      ["auth.scoped_key.forbidden", "warn"],
      ["auth.api_secret.rejected", "warn"],
      ["auth.api_secret.rejected", "warn"],
    ],
  );
  for (const status of [200, 503]) {
    const log = logs.find((entry) => entry.http?.statusCode === status);
    assert.ok(log, `HTTP ${status} remains logged`);
    assert.ok(log.http.responseTime >= 1, "HTTP duration remains logged");
  }
  const routeFailure = logs.find((log) => log.event_key === "http.request.5xx");
  assert.ok(routeFailure, "unexpected 5xx keeps its route-failure event key");
  assert.equal(routeFailure.level, "error");
  assert.equal(routeFailure.status_code, 500);
  assert.equal(result.stdout.includes("scoped-secret"), false);
  assert.equal(result.stdout.includes("global-test-secret"), false);
});
