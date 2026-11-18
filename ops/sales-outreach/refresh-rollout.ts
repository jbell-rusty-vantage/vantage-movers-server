import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getSalesOutreachRefreshRequestModel } from "../../src/models/salesOutreach/refreshRequests";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { csiOperatorActor } from "../../src/services/salesIntelligence/auth";
import { patchSalesOutreachConfiguration } from "../../src/services/salesOutreach/config/commands";
import { createConfigurationLoader } from "../../src/services/salesOutreach/config/load";
import { configurationContentHash } from "../../src/services/salesOutreach/config/store";
import { assertProductionWriterMatchesDeployment } from "../lib/production-writer-guard";

async function main() {
  const [target, mode, approval, parity] = process.argv.slice(2);
  if (target !== getMongoDatabaseName() || !approval?.trim() || !["shadow", "active", "off"].includes(mode)
      || (mode === "active" && !parity?.trim())) throw new Error("Expected target database, shadow|active|off, approval reference and (for active) parity reference");
  await connectMongo();
  await assertProductionWriterMatchesDeployment();
  const loader = createConfigurationLoader();
  const current = await loader.requireActive();
  const { refresh_requests: previous, ...value } = current.value;
  if ((previous?.mode ?? "off") === mode) {
    console.log(JSON.stringify({ mode, revision: current.revision, changed: false }));
    return;
  }
  if (mode === "active") {
    const requests = getSalesOutreachRefreshRequestModel();
    const match = await requests.exists({ compared_configuration: current.version, compared_parity: "match" }).maxTimeMS(5000);
    const mismatch = await requests.exists({ last_shadow_mismatch_configuration: current.version }).maxTimeMS(5000);
    if (!match || mismatch) throw new Error("Current shadow configuration needs matched live comparisons and resolved differences");
  }
  const control = mode === "active" ? { version: "w2-v1", mode, approval_ref: approval, parity_ref: parity }
    : { version: "w2-v1", mode, approval_ref: approval };
  const id = `refresh-rollout:${current.revision}:${mode}`;
  const result = await patchSalesOutreachConfiguration({ actor: csiOperatorActor(id), expected_revision: current.revision,
    idempotency_key: id, value: mode === "off" ? value : { ...value, refresh_requests: control } });
  const verified = await loader.requireActive();
  const { refresh_requests: next, ...rest } = verified.value;
  if (verified.revision !== result.response.revision || (next?.mode ?? "off") !== mode ||
      configurationContentHash(rest) !== configurationContentHash(value)) throw new Error("Refresh rollout verification failed");
  console.log(JSON.stringify({ mode, revision: verified.revision, changed: result.response.changed }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
