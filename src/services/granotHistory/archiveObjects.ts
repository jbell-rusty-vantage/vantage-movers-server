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
    const existing = await storage(false).objects.get({ bucket: ARCHIVE_BUCKET, object,
      fields: "generation,metageneration,customTime,temporaryHold,metadata" }, { timeout: 15000 });
    generation = existing.data.generation;
    if (existing.data.customTime && existing.data.temporaryHold && !existing.data.metadata?.granotReleaseReview &&
        existing.data.metadata?.granotPublisherHold !== "1") {
      throw new Error("Granot archive recovery clock has an independent hold");
    }
    if (existing.data.metadata?.granotReleaseReview || (existing.data.customTime && !existing.data.temporaryHold)) {
      // A concurrent release must lose its metadata CAS before this generation can acquire another reader.
      if (!generation || !existing.data.metageneration) throw new Error("Granot archive metadata fence missing");
      const metadataWriter = google.storage({ version: "v1", auth: createGoogleServiceAccountAuth([
        "https://www.googleapis.com/auth/devstorage.full_control",
      ]) });
      await metadataWriter.objects.patch({
        bucket: ARCHIVE_BUCKET, object, generation, ifGenerationMatch: generation,
        ifMetagenerationMatch: existing.data.metageneration,
        requestBody: { temporaryHold: true, metadata: { ...existing.data.metadata, granotReleaseReview: "", granotPublisherHold: "1" } },
      }, { timeout: 15000 });
    }
  }
  if (!generation) throw new Error("Granot archive generation unavailable");
  const persisted = await readArchiveObject(database, hash, generation);
  if (persisted.length !== bytes.length || digest(persisted) !== hash) throw new Error("Granot archive read-back failed");
  return { hash, persisted, generation };
}
