import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { OutreachActor } from "./auth";
import { OutreachError } from "./errors";
import { resolveOutreachGranotLink } from "./granotLink";
import { fixedConfigurationLoader, activeInspection } from "./reads/testing";
import { completeConfigurationInput } from "./evaluation/testing";

test("the auth pause refuses every Desk role and legacy refresh without any provider or Lead access", async () => {
  const loader = fixedConfigurationLoader(activeInspection(completeConfigurationInput()));
  for (const role of ["rep", "owner", "manager"] as const) {
    const actor: OutreachActor = { role, agent_id: role === "rep" ? "a".repeat(24) : null, actor: { kind: role, id: "synthetic", request_id: "synthetic", run_id: null } };
    for (const refresh of [false, true]) {
      await assert.rejects(resolveOutreachGranotLink(actor, "b".repeat(24), refresh, { loader, now: new Date() }), (error: unknown) => error instanceof OutreachError
        && error.code === "SERVICE_UNAVAILABLE" && error.issues?.[0]?.code === "auth_fix_pending" && error.issues[0].message === "Attempting auth fix.");
    }
  }
  const source = readFileSync(join(__dirname, "granotLink.ts"), "utf8");
  assert.doesNotMatch(source, /readGranotCredentials|retrieveGranotJobFormLink|granot_job_form_link|fetch\(|\.read\(|\.save\(/);
});
