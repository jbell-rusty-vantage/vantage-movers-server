import { GRANOT_CRM_DEFAULT_ORIGIN } from "../../api/config/domain";
import {
  GRANOT_CRM_SOURCE_SEEDS,
  buildRegistryKey,
} from "../../api/services/granotCrmCsv";
import { putGranotCrmObject } from "../../api/services/granotCrmCsv/storage";

async function main() {
  const crmOrigin =
    process.env.GRANOT_CRM_ORIGIN?.trim() || GRANOT_CRM_DEFAULT_ORIGIN;
  const registry = {
    crm_origin: crmOrigin,
    generated_at: new Date().toISOString(),
    workspaces: GRANOT_CRM_SOURCE_SEEDS.map((seed) => ({
      slug: seed.workspace_slug,
      granot_label: seed.granot_label,
      default_channel: seed.default_channel,
      source_company: seed.source_company,
      enabled: seed.enabled ?? true,
      csv_paths: seed.csv_paths ?? {},
      notes: seed.notes,
    })),
  };
  const key = buildRegistryKey(crmOrigin);
  const result = await putGranotCrmObject({
    key,
    body: JSON.stringify(registry, null, 2),
    contentType: "application/json; charset=utf-8",
  });
  console.log(
    JSON.stringify(
      {
        ok: true,
        bucket: result.bucket,
        key: result.key,
        workspace_count: registry.workspaces.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
