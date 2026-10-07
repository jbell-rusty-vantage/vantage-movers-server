import { z } from "zod";

/**
 * Systems tab (doc 11b): the Owner's "Edit locations" PATCH and the capacity read's query.
 * The key set is fixed (unknown keys are refused); only labels, links and notes change; every link is `https://`.
 */

const HTTPS_MESSAGE = "Links must start with https://";

const httpsUrl = z
  .string()
  .trim()
  .max(500, "Links can be at most 500 characters.")
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && Boolean(url.hostname) && !/\s/.test(value);
    } catch {
      return false;
    }
  }, HTTPS_MESSAGE);

/** Optional link: an empty string clears it. */
const optionalHttpsUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  httpsUrl.nullable(),
);

const optionalNote = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.string().trim().max(200, "Notes can be at most 200 characters.").nullable(),
);

const pathChip = z
  .string()
  .trim()
  .regex(/^\/[A-Za-z0-9._~\-/]*$/, "Each path starts with / and has no spaces, for example /top10.");

const locationEntryPatch = z
  .object({
    label: z.string().trim().min(1, "Each row needs a label.").max(80, "Labels can be at most 80 characters."),
    url: httpsUrl,
    note: optionalNote,
    paths: z.array(pathChip).max(12, "At most 12 paths."),
    code_url: optionalHttpsUrl,
    code_note: optionalNote,
    host_url: optionalHttpsUrl,
    logs_url: optionalHttpsUrl,
  })
  .partial()
  .strict();

const locationKeys = {
  extension: locationEntryPatch,
  main_site: locationEntryPatch,
  partner_pages: locationEntryPatch,
  wordpress: locationEntryPatch,
  dashboard: locationEntryPatch,
  server: locationEntryPatch,
  mcp: locationEntryPatch,
};

export const systemsLocationsPatchSchema = z
  .object({
    revision: z.number().int().min(1),
    reason: z.string().trim().max(300).optional(),
    locations: z.object(locationKeys).partial().strict(),
  })
  .strict();

export type SystemsLocationsPatch = z.infer<typeof systemsLocationsPatchSchema>;

export const systemsCapacityQuerySchema = z
  .object({
    refresh: z.enum(["0", "1", "true", "false"]).optional(),
  })
  .strict()
  .transform((query) => ({ refresh: query.refresh === "1" || query.refresh === "true" }));

/** The first validation message in Owner words, for the Edit form. */
export function firstSystemsValidationMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "The locations could not be saved.";
  if (issue.code === "unrecognized_keys") return "Only the listed locations can be changed.";
  const where = issue.path.filter((part) => part !== "locations").join(" › ");
  return where ? `${where}: ${issue.message}` : issue.message;
}
