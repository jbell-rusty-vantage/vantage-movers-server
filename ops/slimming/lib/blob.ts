/**
 * Vercel Blob access for the slimming tools. `listBlobs` and `listTopLevelFolders` are read-only; the inventory
 * and a purge dry run import nothing else. `downloadBlob` and `deleteBlobKeys` are called by `purge.ts --apply`
 * only, with exact pathnames from the manifest (never a prefix).
 */
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { del, get, list } from "@vercel/blob";

export type BlobObject = { pathname: string; size: number; uploadedAt: string; etag: string };

export async function listBlobs(token: string, prefix: string): Promise<BlobObject[]> {
  const out: BlobObject[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ token, prefix, cursor, limit: 1000 });
    for (const b of page.blobs) out.push({ pathname: b.pathname, size: b.size, uploadedAt: b.uploadedAt.toISOString(), etag: b.etag });
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out.sort((a, b) => a.pathname.localeCompare(b.pathname));
}

export async function listTopLevelFolders(token: string): Promise<{ folders: string[]; rootObjects: number }> {
  const folders = new Set<string>();
  let rootObjects = 0;
  let cursor: string | undefined;
  do {
    const page = await list({ token, mode: "folded", cursor, limit: 1000 });
    for (const f of page.folders) folders.add(f);
    rootObjects += page.blobs.length;
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return { folders: [...folders].sort(), rootObjects };
}

/**
 * Streams one private blob to `destination` and returns the byte count and sha256 of the bytes that were streamed
 * into the file (not the Blob metadata), or null when it no longer exists. The caller re-checks the file on disk
 * (`verifyBlobBackupFile`) against the listed size and this hash before it counts as a backup.
 */
export async function downloadBlob(token: string, pathname: string, destination: string): Promise<{ bytes: number; sha256: string } | null> {
  const result = await get(pathname, { access: "private", token, useCache: false });
  if (!result || result.statusCode !== 200) return null;
  const hash = createHash("sha256");
  let bytes = 0;
  const tap = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      bytes += chunk.length;
      callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(result.stream as unknown as WebReadableStream<Uint8Array>), tap, createWriteStream(destination));
  return { bytes, sha256: hash.digest("hex") };
}

/** Deletes exact pathnames in bounded batches. */
export async function deleteBlobKeys(token: string, pathnames: readonly string[], batchSize = 100): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < pathnames.length; i += batchSize) {
    const batch = pathnames.slice(i, i + batchSize);
    await del([...batch], { token });
    deleted += batch.length;
  }
  return deleted;
}
