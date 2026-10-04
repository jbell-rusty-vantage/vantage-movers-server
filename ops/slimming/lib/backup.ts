/**
 * Pre-purge backups: one gzipped canonical-EJSON file per namespace (one document per line), streamed, with
 * its document count and the sha256 of the written file. `verifyBackupFile` re-reads the file, parses every
 * line and checks both the count and the hash before any mutation is allowed to proceed.
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { PassThrough, Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import { BSON, type Document } from "mongodb";

export type BackupEntry = {
  namespace: string;
  filter: Document;
  file: string;
  documents: number;
  sha256: string;
  bytes: number;
  indexes: Document[];
  /** Set on cleanup selections: the cleanup whose mutations this file covers (the initial selection and any extras). */
  cleanup_id?: string;
};

/** Stable identity of a document `_id` (any BSON type) for backup-coverage checks. */
export const idKey = (id: unknown): string => BSON.EJSON.stringify({ id } as Document, { relaxed: true });

/** The `_id` keys (see `idKey`) of every document in a backup file. */
export async function readBackupIdKeys(file: string): Promise<Set<string>> {
  const keys = new Set<string>();
  for await (const line of createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity })) {
    if (!line) continue;
    keys.add(idKey((BSON.EJSON.parse(line, { relaxed: false }) as Document)._id));
  }
  return keys;
}

export async function writeBackupFile(source: AsyncIterable<Document>, file: string): Promise<{ documents: number; sha256: string; bytes: number }> {
  let documents = 0;
  let bytes = 0;
  const hash = createHash("sha256");
  async function* lines() {
    for await (const doc of source) {
      documents += 1;
      yield `${BSON.EJSON.stringify(doc, { relaxed: false })}\n`;
    }
  }
  const tap = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      bytes += chunk.length;
      callback(null, chunk);
    },
  });
  await pipeline(Readable.from(lines()), createGzip({ level: 6 }), tap, createWriteStream(file));
  return { documents, sha256: hash.digest("hex"), bytes };
}

export async function verifyBackupFile(file: string, expected: { documents: number; sha256: string }): Promise<void> {
  const hash = createHash("sha256");
  const raw = createReadStream(file);
  raw.on("data", (chunk) => hash.update(chunk as Buffer));
  const text = new PassThrough();
  const settled = pipeline(raw, createGunzip(), text).then(
    () => null,
    (error: unknown) => error,
  );
  let documents = 0;
  try {
    for await (const line of createInterface({ input: text, crlfDelay: Infinity })) {
      if (!line) continue;
      BSON.EJSON.parse(line, { relaxed: false });
      documents += 1;
    }
  } finally {
    const streamError = await settled;
    if (streamError) throw streamError;
  }
  const digest = hash.digest("hex");
  if (documents !== expected.documents) throw new Error(`backup ${file}: ${documents} documents read back, ${expected.documents} written`);
  if (digest !== expected.sha256) throw new Error(`backup ${file}: sha256 ${digest} differs from ${expected.sha256}`);
}

export const fileSha256 = async (file: string): Promise<string> => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
};

/**
 * Checks a downloaded Blob backup on disk: the file's size (stat) must equal the size the Blob listing reported,
 * and the sha256 of the file as read back must equal the hash of the bytes streamed into it (when given). Returns
 * what reached the disk; throws on any mismatch so a short or corrupted download never counts as a backup.
 */
export async function verifyBlobBackupFile(
  file: string,
  expected: { listedSize: number; streamedSha256?: string },
): Promise<{ bytes: number; sha256: string }> {
  const bytes = (await stat(file)).size;
  if (bytes !== expected.listedSize) throw new Error(`blob backup ${file}: ${bytes} bytes on disk, listing says ${expected.listedSize}`);
  const sha256 = await fileSha256(file);
  if (expected.streamedSha256 && sha256 !== expected.streamedSha256)
    throw new Error(`blob backup ${file}: sha256 on disk ${sha256} differs from the streamed ${expected.streamedSha256}`);
  return { bytes, sha256 };
}
