import { google } from "googleapis";
import { createGoogleServiceAccountAuth } from "../googleAuth/serviceAccount";
import { ARCHIVE_BUCKET, archiveObject, digest } from "./archiveCodec";

const storage = (write: boolean) => google.storage({ version: "v1", auth: createGoogleServiceAccountAuth([
  write ? "https://www.googleapis.com/auth/devstorage.read_write" : "https://www.googleapis.com/auth/devstorage.read_only",
]) });

export async function readArchiveObject(database: string, hash: string, generation?: string) {
  const result = await storage(false).objects.get({ bucket: ARCHIVE_BUCKET, object: archiveObject(database, hash), generation, alt: "media" }, { responseType: "arraybuffer", timeout: 15000 });
  return Buffer.from(result.data as unknown as ArrayBuffer);
}

/** Content addressing and generation zero make retries safe. Always verify the persisted bytes. */
export async function storeArchiveObject(database: string, bytes: Buffer) {
  const hash = digest(bytes);
  const object = archiveObject(database, hash);
  let generation: string | null | undefined;
  try {
    const created = await storage(true).objects.insert({ bucket: ARCHIVE_BUCKET, name: object, fields: "generation",
      ifGenerationMatch: "0", media: { mimeType: "application/octet-stream", body: bytes } }, { timeout: 30000 });
    generation = created.data.generation;
  } catch (error) {
    if (Number((error as { code?: unknown }).code) !== 412) throw error;
    const existing = await storage(false).objects.get({ bucket: ARCHIVE_BUCKET, object, fields: "generation" }, { timeout: 15000 });
    generation = existing.data.generation;
  }
  if (!generation) throw new Error("Granot archive generation unavailable");
  const persisted = await readArchiveObject(database, hash, generation);
  if (persisted.length !== bytes.length || digest(persisted) !== hash) throw new Error("Granot archive read-back failed");
  return { hash, persisted, generation };
}
