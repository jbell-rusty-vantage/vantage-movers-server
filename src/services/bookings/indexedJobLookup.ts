import { jobNumberDigitCore } from "./bookingIdentity";

const letters = Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
/**
 * A bare digit core and any uppercase letter prefix are equivalent. Short lists can probe
 * every single-letter spelling directly. Longer prefixes occupy 26 disjoint lexical ranges
 * (AA through AZ..., BA through BZ..., etc.). This preserves arbitrary prefix lengths.
 * A wide batch amortizes one scan over the whole set of cores.
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
  if (access === "scan" || cores.length > 4)
    return {
      $or: [
        { normalized_job_no: { $in: [...exact] } },
        { normalized_job_no: { $regex: "^[A-Z]+" + suffix } },
      ],
    };
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

/** All raw/normalized disagreements and every raw value needing normalization are still
 * inspected by the canonical JavaScript normalizer. Equal ASCII alphanumerics are already
 * covered by the normalized job query, including leading-zero identities. */
export const legacyBookingJobFilter = {
  job_no: { $type: "string" as const },
  $or: [
    { $expr: { $ne: ["$job_no", { $ifNull: ["$normalized_job_no", null] }] } },
    { job_no: { $regex: "[^A-Z0-9]" } },
  ],
};
