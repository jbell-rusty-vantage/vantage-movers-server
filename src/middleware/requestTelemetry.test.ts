import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("request telemetry stays in HTTP/application logs while auth denials still reach the event writer", () => {
  // A separate process exercises enabled capture flags. The normal test runner
  // intentionally disables them. Install the in-memory writer sink BEFORE any
  // middleware, omit database credentials, and never permit a Mongo connection.
  const result = spawnSync(process.execPath, ["--import", "tsx", "--eval", `
    const assert = require('node:assert/strict');
    const sink = require('./src/services/observability/testObservabilitySink.ts');
    sink.installTestObservabilitySink();
    const { shouldCaptureAuthEvents } = require('./src/config/domain/observability.ts');
    assert.equal(shouldCaptureAuthEvents(), true);
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
      assert.equal(sink.getCapturedOperationalEvents().length, 0);
      assert.equal((await auth('scoped-secret', '/forbidden')).status, 403);
      assert.equal((await auth('wrong-secret', '/allowed')).status, 401);
      assert.equal((await auth(undefined, '/allowed')).status, 401);
      assert.deepEqual(sink.getCapturedOperationalEvents().map(x => x.input.eventKey), [
        'auth.scoped_key.forbidden', 'auth.api_secret.rejected', 'auth.api_secret.rejected'
      ]);
      sink.clearCapturedOperationalEvents();
      const server = http.createServer((req, res) => {
        httpLogger(req, res);
        setTimeout(() => { res.statusCode = req.url === '/failed' ? 503 : 200; res.end('done'); }, 15);
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      try {
        const base = 'http://127.0.0.1:' + server.address().port;
        assert.equal((await fetch(base + '/slow')).status, 200);
        assert.equal((await fetch(base + '/failed')).status, 503);
        assert.equal(sink.getCapturedOperationalEvents().length, 0);
      } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
      }
      // Exercise the real v1 error handler. Missing Mongo configuration fails
      // locally before any connection attempt, and must still emit its 5xx.
      process.env.OBSERVABILITY_CAPTURE_HTTP_5XX = 'true';
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
        assert.deepEqual(sink.getCapturedOperationalEvents().map(x => x.input.eventKey), ['http.request.5xx']);
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
      OBSERVABILITY_ENABLED: "true",
      OBSERVABILITY_WRITE_MODE: "enabled",
      OBSERVABILITY_CAPTURE_AUTH_EVENTS: "true",
      OBSERVABILITY_CAPTURE_HTTP_5XX: "false",
      OBSERVABILITY_SLOW_REQUEST_MS: "1",
      VANTAGE_SCOPED_API_KEYS: JSON.stringify([{ name: "test-key", secret: "scoped-secret", routes: [{ method: "GET", path: "/allowed" }] }]),
    },
  });
  assert.equal(result.status, 0, result.stderr || `${result.error}\n${result.stdout}`);
  const logs = result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.equal(logs.filter(log => log.msg === "auth.scoped_key.accepted").length, 1);
  for (const status of [200, 503]) {
    const log = logs.find(log => log.http?.statusCode === status);
    assert.ok(log, `HTTP ${status} remains logged`);
    assert.ok(log.http.responseTime >= 1, "HTTP duration remains logged");
  }
  assert.equal(result.stdout.includes("scoped-secret"), false);
});
