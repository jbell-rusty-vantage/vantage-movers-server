import type { Db, Document } from "mongodb";

export const RECENT_OFFICIAL_BOOKING_EXAMPLE_LIMIT = 3;

export type RecentOfficialBookingExample = {
  job_no: string;
  booked_at: string;
};

export type RecentOfficialBookingLister = {
  findBookings(query: {
    filter: Document;
    projection: Document;
    sort: Document;
    limit: number;
  }): Promise<Document[]>;
};

const SAFE_PROJECTION = {
  job_no: 1,
  normalized_job_no: 1,
  book_date: 1,
  createdAt: 1,
  timestamp: 1,
} as const;

const HAS_JOB_NUMBER = {
  $or: [
    { job_no: { $type: "string", $ne: "" } },
    { normalized_job_no: { $type: "string", $ne: "" } },
  ],
};

function asJobNo(row: Document): string | undefined {
  if (typeof row.job_no === "string" && row.job_no.trim()) {
    return row.job_no.trim();
  }
  if (typeof row.normalized_job_no === "string" && row.normalized_job_no.trim()) {
    return row.normalized_job_no.trim();
  }
  return undefined;
}

function asBookedAt(row: Document): string {
  for (const value of [row.book_date, row.createdAt, row.timestamp]) {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "string" && value.trim()) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
  }
  return "";
}

export async function listRecentOfficialBookingExamples(
  deps: RecentOfficialBookingLister,
): Promise<RecentOfficialBookingExample[]> {
  const rows = await deps.findBookings({
    filter: HAS_JOB_NUMBER,
    projection: { ...SAFE_PROJECTION },
    sort: { book_date: -1, createdAt: -1 },
    limit: RECENT_OFFICIAL_BOOKING_EXAMPLE_LIMIT,
  });

  const examples: RecentOfficialBookingExample[] = [];
  for (const row of rows) {
    if (examples.length >= RECENT_OFFICIAL_BOOKING_EXAMPLE_LIMIT) break;
    const job_no = asJobNo(row);
    if (!job_no) continue;
    examples.push({ job_no, booked_at: asBookedAt(row) });
  }
  return examples;
}

export function createMongoRecentOfficialBookingLister(db: Db): RecentOfficialBookingLister {
  return {
    async findBookings({ filter, projection, sort, limit }) {
      return db
        .collection("booked_leads")
        .find(filter)
        .project(projection)
        .sort(sort)
        .limit(limit)
        .toArray();
    },
  };
}
