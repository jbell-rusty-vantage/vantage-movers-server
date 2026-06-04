import assert from "node:assert/strict";
import test from "node:test";
import { getCplForSource } from "./cpl";

/**
 * CPL values are snapshot at module load (mirroring the original
 * `api/config/domain.ts` semantics). These tests assert the defaults that
 * apply when the corresponding `*_CPL` env vars are unset.
 *
 * Tests run with no `*_CPL` env vars set (the dev/test envs do not set
 * them); if a future contributor sets them in their environment, these
 * assertions will rightly fail and surface that the module-load snapshot
 * was affected by the surrounding env.
 */

test("simple-rate sources return their single configured CPL regardless of local", () => {
  assert.equal(getCplForSource("tbm_leads", undefined), 190);
  assert.equal(getCplForSource("tbm_leads", "local"), 190);
  assert.equal(getCplForSource("tbm_leads", "long_distance"), 190);

  assert.equal(getCplForSource("tbm_prime_leads", "long_distance"), 190);
  assert.equal(getCplForSource("top10_leads", "long_distance"), 190);
  assert.equal(getCplForSource("main_site", "long_distance"), 0);
});

test("best_relocation_leads splits CPL by local vs long_distance", () => {
  assert.equal(getCplForSource("best_relocation_leads", "local"), 40);
  assert.equal(getCplForSource("best_relocation_leads", "long_distance"), 195);
  // undefined local falls back to long_distance.
  assert.equal(getCplForSource("best_relocation_leads", undefined), 195);
});

test("not_provided always reports CPL 0 (no env var, no source sheet)", () => {
  assert.equal(getCplForSource("not_provided", undefined), 0);
  assert.equal(getCplForSource("not_provided", "local"), 0);
  assert.equal(getCplForSource("not_provided", "long_distance"), 0);
});
