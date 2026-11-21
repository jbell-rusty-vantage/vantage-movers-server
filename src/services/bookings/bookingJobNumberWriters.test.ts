import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import test from "node:test";

/**
 * The Booking Job Number rule and the `normalized_job_no` invariant are enforced by `BookedLead`
 * document and query middleware. Raw driver access to `booked_leads` bypasses both, so every
 * source file that touches the raw collection is listed here as a reader or a writer, and no raw
 * write may set `job_no`, directly or through the object it is given. A new raw access fails this
 * test until it is reviewed against the rule and added.
 */
const RAW_ACCESS: Record<string, "reader" | "writer"> = {
  "src/services/cancellations/cancelledLead.service.ts": "writer", // cancellation claim: $set cancelled
  "src/services/domainCommands/bookings.ts": "writer", // updateBooking: official details only
  "src/services/granotLifecycle/bookingOwnerCommands.ts": "writer", // Granot Update: official details only
  "src/services/granotLifecycle/connectBookingToLead.ts": "writer", // Connect: lead_ref and flags only
  "src/services/granotLifecycle/releaseOwnerCommands.ts": "writer", // Granot Release: release fields only
  "src/services/bookings/bookingJobNormalizationInvariant.ts": "reader",
  "src/services/jobNumberTimeline/mongo-evidence-loader.ts": "reader",
  "src/services/jobNumberTimeline/recent-official-bookings.ts": "reader",
  "src/services/salesOutreach/live/repMetrics.ts": "reader",
  "src/services/salesOutreach/pool/admission.ts": "reader",
};

/** Any handle on the raw collection: the Mongoose driver handle, or `collection(...)` naming it. */
const HANDLE = String.raw`(?:BookedLead\.collection(?!\.collectionName)|\.collection\s*(?:<[^>()]*>)?\(\s*(?:["'\`]booked_leads["'\`]|BookedLead\.collection\.collectionName)\s*\))`;
const WRITE_METHODS = "insertOne|insertMany|updateOne|updateMany|replaceOne|findOneAndUpdate|findOneAndReplace|findOneAndDelete|deleteOne|deleteMany|bulkWrite|drop";
const ACCESS = new RegExp(HANDLE);
const WRITE = new RegExp(`${HANDLE}\\s*\\.\\s*(?:${WRITE_METHODS})\\s*\\(`, "g");
const SETS_JOB = /(?<![A-Za-z_.])job_no\b(?!_)/;

/** Text of the balanced `(...)` argument list that starts at `open`. */
function argumentList(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")" && --depth === 0) return source.slice(open + 1, i);
  }
  return source.slice(open + 1);
}

/** Top-level comma-separated arguments of an argument list. */
function splitArguments(args: string): string[] {
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < args.length; i++) {
    const ch = args[i];
    if ("([{".includes(ch!)) depth++;
    else if (")]}".includes(ch!)) depth--;
    else if (ch === "," && depth === 0) { out.push(args.slice(start, i)); start = i + 1; }
  }
  out.push(args.slice(start));
  return out;
}

/** The argument that carries written values: the update or replacement, or the inserted documents. */
function writtenArgument(method: string, args: string): string {
  const parts = splitArguments(args);
  if (/^(?:insertOne|insertMany|bulkWrite)$/.test(method)) return parts[0] ?? "";
  if (/^(?:deleteOne|deleteMany|findOneAndDelete|drop)$/.test(method)) return "";
  return parts[1] ?? "";
}

/** Bodies of every `const|let name = …;` and `function name(…) {…}` declared in the same file. */
function declaration(source: string, name: string): string {
  const bodies: string[] = [];
  for (const at of source.matchAll(new RegExp(String.raw`(?:(?:const|let|var)\s+${name}\b[^=;]*=|function\s+${name}\s*\()`, "g"))) {
    const isFunction = at[0].startsWith("function");
    const start = (at.index ?? 0) + at[0].length;
    const brace = source.indexOf("{", start);
    const semi = source.indexOf(";", start);
    if (brace < 0 || (!isFunction && semi >= 0 && semi < brace)) { bodies.push(source.slice(start, semi < 0 ? undefined : semi)); continue; }
    let depth = 0, end = source.length;
    for (let i = brace; i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}" && --depth === 0) { end = i + 1; break; }
    }
    bodies.push(source.slice(start, end));
  }
  return bodies.join("\n");
}

/** The written values of one call plus, one level deep, the local declarations they reference. */
function writtenText(source: string, args: string): string {
  const seen = new Set<string>();
  let text = args;
  for (let depth = 0; depth < 3; depth++) {
    const names = [...text.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*(?=[(,)}\]\s.]|$)/g)].map((m) => m[1]!)
      .filter((name) => !seen.has(name) && !/^(?:await|session|tx|input|new|true|false|null|undefined)$/.test(name));
    if (!names.length) break;
    for (const name of names) { seen.add(name); text += `\n${declaration(source, name)}`; }
  }
  return text.replace(/normalized_job_no/g, "").replace(/job_no_snapshot/g, "");
}

test("every raw booked_leads access is reviewed and no raw write sets job_no", () => {
  const found = Object.fromEntries(globSync("src/**/*.ts")
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => !/\.test\.ts$/.test(file) && ACCESS.test(readFileSync(file, "utf8")))
    .map((file) => [file, new RegExp(WRITE.source).test(readFileSync(file, "utf8")) ? "writer" : "reader"]));
  assert.deepEqual(found, Object.fromEntries(Object.entries(RAW_ACCESS).sort()), "raw booked_leads access changed; review it against the Job Number rule");
  for (const [file, kind] of Object.entries(found)) {
    if (kind !== "writer") continue;
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(WRITE)) {
      const open = (match.index ?? 0) + match[0].length - 1;
      const method = /\.\s*(\w+)\s*\($/.exec(match[0])![1]!;
      const written = writtenArgument(method, argumentList(source, open));
      assert.equal(SETS_JOB.test(writtenText(source, written)), false, `${file}: a raw booked_leads ${method} may set job_no`);
    }
  }
});

test("the job_no detector follows prebuilt objects and helper functions", () => {
  const helper = `function desiredBooking(x) { return { book_date: x, job_no: x.job }; }\n`;
  const prebuilt = `const desired = desiredBooking(input);\nawait BookedLead.collection.updateOne({ _id: id }, { $set: desired });`;
  const source = helper + prebuilt;
  const write = new RegExp(WRITE.source, "g").exec(source)!;
  assert.equal(SETS_JOB.test(writtenText(source, writtenArgument("updateOne", argumentList(source, write.index + write[0].length - 1)))), true);
  const safe = `const desired = { cancelled: id, normalized_job_no: "P1" };\nawait db.collection("booked_leads").updateOne({ normalized_job_no: job }, { $set: desired });`;
  const safeWrite = new RegExp(WRITE.source, "g").exec(safe)!;
  assert.equal(SETS_JOB.test(writtenText(safe, writtenArgument("updateOne", argumentList(safe, safeWrite.index + safeWrite[0].length - 1)))), false);
  const inserted = `const row = { job_no: "Jane" };
await BookedLead.collection.insertOne(row);`;
  const insertWrite = new RegExp(WRITE.source, "g").exec(inserted)!;
  assert.equal(SETS_JOB.test(writtenText(inserted, writtenArgument("insertOne", argumentList(inserted, insertWrite.index + insertWrite[0].length - 1)))), true);
  assert.ok(new RegExp(WRITE.source).test(`mongoose.connection.collection(BookedLead.collection.collectionName).insertOne({})`));
  assert.ok(new RegExp(WRITE.source).test(`db.collection<Row>("booked_leads").bulkWrite([])`));
});
