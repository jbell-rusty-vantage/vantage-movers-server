import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { intelligenceEnvelopeSchema } from "../src/validation/intelligence/intelligenceEnvelope.validation";
import { intelligenceToolArguments, CSI_PROMPT_TEMPLATE, CSI_PROMPT_VERSION } from "../src/services/salesIntelligence/analysis/contracts";
import { payloadHash } from "../src/services/salesIntelligence/transactions";

const envelope_schema = z.toJSONSchema(intelligenceEnvelopeSchema);
const artifact = {
  schema_version: "csi-envelope-v1",
  schema_digest: payloadHash(envelope_schema),
  prompt_version: CSI_PROMPT_VERSION,
  prompt_template: CSI_PROMPT_TEMPLATE,
  envelope_schema,
  tools: Object.fromEntries(Object.entries(intelligenceToolArguments).map(([name, schema]) => [name, z.toJSONSchema(schema)])),
  validation_note: "Generated structural schema; authoritative server parsing also enforces cross-field refinements, total summary length and evidence authority.",
};
const directory = resolve(process.argv[2] ?? "../vantage-movers-mcp/lib/intelligence/generated");
mkdirSync(directory, { recursive: true });
writeFileSync(resolve(directory, "intelligence-contract-v1.json"), JSON.stringify(artifact, null, 2) + "\n");
console.log("Generated csi-envelope-v1 structural schema and scoped tool contract", artifact.schema_digest);
