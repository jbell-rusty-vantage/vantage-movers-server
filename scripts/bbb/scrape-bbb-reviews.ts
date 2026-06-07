import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { ApifyClient } from "apify-client";

const DEFAULT_REVIEWS_URL =
  "https://www.bbb.org/us/fl/boynton-beach/profile/moving-brokers/vantage-movers-llc-0633-92031922/customer-reviews";

const DEFAULT_DAYS = 5475; // ~15 years — BBB actor max

type BbbRawRecord = {
  category?: string;
  user?: string;
  stars?: number;
  date?: string;
  source_url?: string;
  details?: string;
  status?: string;
  type?: string;
};

type BbbReview = {
  name: string;
  stars: number;
  date: string;
  text: string;
  sourceUrl: string;
};

function parseArgs(argv: string[]) {
  let url = DEFAULT_REVIEWS_URL;
  let days = DEFAULT_DAYS;
  let minStars = 4;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--url" && argv[i + 1]) {
      url = argv[i + 1]!;
      i += 1;
      continue;
    }
    if (arg === "--days" && argv[i + 1]) {
      days = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--min-stars" && argv[i + 1]) {
      minStars = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith("http")) {
      url = arg;
    }
  }

  if (!Number.isFinite(days) || days < 30 || days > DEFAULT_DAYS) {
    throw new Error(`--days must be between 30 and ${DEFAULT_DAYS}.`);
  }

  if (!Number.isFinite(minStars) || minStars < 1 || minStars > 5) {
    throw new Error("--min-stars must be between 1 and 5.");
  }

  return { url, days, minStars };
}

function getApifyToken(): string {
  const token = process.env.APIFY_API_KEY?.trim();
  if (!token) {
    throw new Error("Missing APIFY_API_KEY in environment (.env).");
  }
  return token;
}

function normalizeReviewUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed.includes("bbb.org")) {
    throw new Error("URL must be a bbb.org customer-reviews page.");
  }
  if (trimmed.endsWith("/customer-reviews")) {
    return trimmed;
  }
  if (trimmed.endsWith("/")) {
    return `${trimmed}customer-reviews`;
  }
  return `${trimmed}/customer-reviews`;
}

function isReviewRecord(record: BbbRawRecord): record is BbbRawRecord & {
  stars: number;
  details: string;
} {
  return (
    typeof record.stars === "number" &&
    Number.isFinite(record.stars) &&
    typeof record.details === "string" &&
    record.details.trim().length > 0 &&
    !record.status &&
    !record.type
  );
}

function toReview(record: BbbRawRecord & { stars: number; details: string }): BbbReview {
  return {
    name: record.user?.trim() || "Anonymous",
    stars: record.stars,
    date: record.date?.trim() || "",
    text: record.details.trim(),
    sourceUrl: record.source_url?.trim() || "",
  };
}

function slugFromUrl(url: string): string {
  const match = url.match(/profile\/[^/]+\/([^/]+)\/customer-reviews/);
  return match?.[1]?.replace(/[^a-z0-9-]+/gi, "-") ?? "bbb-reviews";
}

async function main() {
  const { url, days, minStars } = parseArgs(process.argv.slice(2));
  const reviewsUrl = normalizeReviewUrl(url);
  const token = getApifyToken();

  console.log("Scraping BBB customer reviews via Apify...");
  console.log(`  URL: ${reviewsUrl}`);
  console.log(`  Days: ${days}`);
  console.log(`  Min stars: ${minStars}`);

  const client = new ApifyClient({ token });
  const input = {
    url: [reviewsUrl],
    days,
    pause: 3,
    proxy: { useApifyProxy: true },
  };

  const run = await client.actor("canadesk/bulk-bbb").call(input);
  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  const rawRecords = items as BbbRawRecord[];
  const allReviews = rawRecords.filter(isReviewRecord).map(toReview);
  const filteredReviews = allReviews
    .filter((review) => review.stars >= minStars)
    .sort((a, b) => b.stars - a.stars || b.date.localeCompare(a.date));

  const output = {
    scrapedAt: new Date().toISOString(),
    sourceUrl: reviewsUrl,
    apifyRunId: run.id,
    apifyDatasetId: run.defaultDatasetId,
    totalRecords: rawRecords.length,
    totalReviews: allReviews.length,
    filteredReviewCount: filteredReviews.length,
    minStars,
    reviews: filteredReviews,
  };

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const outputDir = path.join(scriptDir, "output");
  await mkdir(outputDir, { recursive: true });

  const slug = slugFromUrl(reviewsUrl);
  const outputPath = path.join(outputDir, `${slug}-reviews.json`);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log("");
  console.log(`Fetched ${rawRecords.length} record(s), ${allReviews.length} review(s).`);
  console.log(
    `Kept ${filteredReviews.length} review(s) with ${minStars}+ star rating.`,
  );
  console.log(`Wrote: ${outputPath}`);
  console.log("");

  if (filteredReviews.length === 0) {
    console.log("No matching reviews found.");
    return;
  }

  for (const [index, review] of filteredReviews.entries()) {
    console.log(`${index + 1}. ${review.name} — ${review.stars}/5 (${review.date})`);
    console.log(`   ${review.text.replace(/\s+/g, " ").slice(0, 240)}${review.text.length > 240 ? "…" : ""}`);
    console.log("");
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`BBB scrape failed: ${message}`);
  process.exitCode = 1;
});
