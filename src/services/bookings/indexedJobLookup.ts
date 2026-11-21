import { jobNumberDigitCore } from "./bookingIdentity";

const letters = Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
/**
 * A bare digit core and any uppercase letter prefix are equivalent. Short lists can probe
 * every single-letter spelling directly. Longer prefixes occupy 26 disjoint lexical ranges
 * (AA through AZ..., BA through BZ..., etc.). This preserves arbitrary prefix lengths.
 * Wide indexed batches probe the common Granot spelling directly as well.
 */
export function normalizedJobCandidates(
  jobs: readonly string[],
  access: "index" | "scan" = "index",
): Record<string, unknown> {
  const cores = [
    ...new Set(jobs.flatMap((job) => jobNumberDigitCore(job) ?? [])),
  ];
  const exact = new Set([...jobs, ...cores]);
  if (!cores.length) return { normalized_job_no: { $in: [...exact] } };
  const suffix = "(?:" + cores.join("|") + ")$";
  if (access === "scan")
    return {
      $or: [
        { normalized_job_no: { $in: [...exact] } },
        { normalized_job_no: { $regex: "^[A-Z]+" + suffix } },
      ],
    };
  if (cores.length > 4) {
    // Granot's common P-prefixed spelling and bare numbers use point lookups. The
    // disjoint ranges still discover every other uppercase prefix, including PA.
    for (const core of cores) {
      exact.add("P" + core);
      exact.add("P" + core + "\n");
    }
    const pattern = "^[A-Z]+" + suffix;
    return { $or: [
      { normalized_job_no: { $in: [...exact] } },
      { normalized_job_no: { $gte: "A", $lt: "P0", $regex: pattern } },
      { normalized_job_no: { $gte: "P:", $lt: "[", $regex: pattern } },
    ] };
  }
  for (const prefix of letters)
    for (const core of cores) {
      exact.add(prefix + core);
      // Mongo's PCRE end anchor also accepts a final newline in legacy unnormalized text.
      exact.add(prefix + core + "\n");
    }
  return {
    $or: [
      { normalized_job_no: { $in: [...exact] } },
      ...letters.map((prefix) => ({
        normalized_job_no: {
          $gte: prefix + "A",
          $lt: prefix + "[",
          $regex: "^[A-Z]{2,}" + suffix,
        },
      })),
    ],
  };
}

/**
 * Lead (`form_leads` / `call_leads`) read for one normalized Job: the same matches as
 * `equivalentNormalizedJobFilter` (the Job itself, its digit core, and the core behind any uppercase letter
 * prefix, including a trailing newline the PCRE `$` also accepts), as indexed point lookups and bounded
 * ranges instead of a regex that walks every letter-prefixed key of the index.
 */
export function leadJobNumberFilter(normalizedJobNo: string): Record<string, unknown> {
  return normalizedJobCandidates([normalizedJobNo]);
}
