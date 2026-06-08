import { readFile } from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import { connectMongo } from "../../api/db";
import { Testimonial } from "../../api/models/Testimonial";
import type { TestimonialSource } from "../../api/config/domain";
import {
  buildContentFingerprint,
  normalizeReviewerName,
  parseReviewDate,
} from "../../api/services/testimonials/testimonial.helpers";

const DEFAULT_SEED_FILES = [
  path.resolve(process.cwd(), "docs/bbb-reviews-testimonials-seed.json"),
  path.resolve(process.cwd(), "docs/bbb-reviews-testimonials-seed-batch-2.json"),
] as const;

type BbbSeedReview = {
  reviewerName: string;
  date: string;
  rating: number;
  reviewText: string;
  businessResponse: {
    date: string;
    text: string;
  } | null;
};

type BbbSeedFile = {
  source: string;
  company?: string;
  reviews: BbbSeedReview[];
};

function parseArgs(argv: string[]): string[] {
  const files: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--file" && argv[i + 1]) {
      files.push(path.resolve(argv[i + 1]!));
      i += 1;
    }
  }

  return files.length > 0 ? files : [...DEFAULT_SEED_FILES];
}

async function loadSeedFile(filePath: string): Promise<BbbSeedFile> {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as BbbSeedFile;

  if (parsed.source !== "BBB") {
    throw new Error(`Unsupported seed source in ${filePath}: ${parsed.source}`);
  }

  if (!Array.isArray(parsed.reviews) || parsed.reviews.length === 0) {
    throw new Error(`No reviews found in ${filePath}`);
  }

  return parsed;
}

function toTestimonialUpdate(review: BbbSeedReview, sourceCompany?: string) {
  const source: TestimonialSource = "BBB";
  const reviewer_name = review.reviewerName.trim();
  const normalized_reviewer_name = normalizeReviewerName(reviewer_name);
  const review_date = parseReviewDate(review.date);
  const review_text = review.reviewText.trim();
  const content_fingerprint = buildContentFingerprint({
    source,
    normalized_reviewer_name,
    review_date,
    review_text,
  });

  return {
    content_fingerprint,
    update: {
      source,
      source_company: sourceCompany?.trim(),
      reviewer_name,
      normalized_reviewer_name,
      review_date,
      rating: review.rating,
      review_text,
      business_response: review.businessResponse
        ? {
            responded_at: parseReviewDate(review.businessResponse.date),
            text: review.businessResponse.text.trim(),
          }
        : null,
      published: true,
      featured: false,
      content_fingerprint,
    },
  };
}

async function seedBbbTestimonials(seedFiles: string[]) {
  await connectMongo();

  const seenFingerprints = new Set<string>();
  let inserted = 0;
  let updated = 0;
  let skippedDuplicates = 0;

  for (const filePath of seedFiles) {
    const seedFile = await loadSeedFile(filePath);
    console.log(`Loading ${seedFile.reviews.length} review(s) from ${filePath}`);

    for (const review of seedFile.reviews) {
      const { content_fingerprint, update } = toTestimonialUpdate(
        review,
        seedFile.company,
      );

      if (seenFingerprints.has(content_fingerprint)) {
        skippedDuplicates += 1;
        continue;
      }
      seenFingerprints.add(content_fingerprint);

      const existing = await Testimonial.findOne({
        source: "BBB",
        content_fingerprint,
      })
        .select("_id")
        .lean();

      await Testimonial.findOneAndUpdate(
        { source: "BBB", content_fingerprint },
        { $set: update },
        { upsert: true, setDefaultsOnInsert: true, runValidators: true },
      );

      if (existing) {
        updated += 1;
      } else {
        inserted += 1;
      }
    }
  }

  const total = await Testimonial.countDocuments({ source: "BBB" });

  console.log(
    [
      `Seed complete.`,
      `Inserted: ${inserted}`,
      `Updated: ${updated}`,
      `Skipped duplicate entries across files: ${skippedDuplicates}`,
      `Total BBB testimonials in collection: ${total}`,
    ].join(" "),
  );
}

async function main() {
  const seedFiles = parseArgs(process.argv.slice(2));
  await seedBbbTestimonials(seedFiles);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("Failed to seed BBB testimonials", error);
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  process.exit(1);
});
