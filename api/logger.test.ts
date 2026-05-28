import assert from "node:assert/strict";
import test from "node:test";
import { logger } from "./logger";

/**
 * Defensive smoke tests for the shared logger.
 *
 * pino's underlying serializer (`safe-stable-stringify`) handles
 * circular references and BigInt values without throwing. These tests
 * lock that in: if a future contributor swaps the logger or adds a
 * custom serializer that throws on awkward inputs, these tests will
 * catch it before the bad logger goes live on Vercel (where a single
 * thrown `JSON.stringify` inside a request handler would surface as a
 * 500, not a log line).
 */

test("logger does not throw when an object passed to info() contains a circular reference", () => {
  const circular: { name: string; self?: unknown } = { name: "ring" };
  circular.self = circular;

  assert.doesNotThrow(() => {
    logger.info({ msg: "logger.test.circular", data: circular });
  });
});

test("logger does not throw when an object passed to info() contains BigInt values", () => {
  assert.doesNotThrow(() => {
    logger.info({
      msg: "logger.test.bigint",
      pos: 1234567890123456789n,
      neg: -9876543210123456789n,
    });
  });
});

test("logger does not throw when err key is a non-Error value", () => {
  assert.doesNotThrow(() => {
    logger.error({ err: "plain string error", msg: "logger.test.string_err" });
    logger.error({ err: { code: "E_BAD", details: { a: 1 } }, msg: "logger.test.object_err" });
    logger.error({ err: null, msg: "logger.test.null_err" });
    logger.error({ err: undefined, msg: "logger.test.undefined_err" });
  });
});

test("logger does not throw when given undefined or null payloads", () => {
  assert.doesNotThrow(() => {
    logger.info("plain string message");
    logger.info({ msg: "logger.test.empty" });
    logger.warn({ msg: "logger.test.warn_no_data" });
  });
});

test("logger exposes the pino API the codebase relies on", () => {
  assert.equal(typeof logger.info, "function");
  assert.equal(typeof logger.warn, "function");
  assert.equal(typeof logger.error, "function");
  assert.equal(typeof logger.debug, "function");
  assert.equal(typeof logger.child, "function");
});
