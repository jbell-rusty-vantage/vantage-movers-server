import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { head, issueSignedToken, presignUrl, put } from "@vercel/blob";
import {
  CONVERSATION_AUDIO_URL_TTL_MS,
  conversationBlobPathname,
} from "../../config/domain/conversations";

function blobStoreId(): string {
  const value = process.env.BLOB_STORE_ID?.trim();
  if (!value) {
    throw new Error("BLOB_STORE_ID is not set");
  }
  return value;
}

function blobToken(): string {
  const value = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!value) {
    throw new Error("BLOB_READ_WRITE_TOKEN is not set");
  }
  return value;
}

export async function uploadConversationMp3(input: {
  providerRecordingId: string;
  filePath: string;
}): Promise<{
  pathname: string;
  url: string;
  bytes: number;
  contentType: string;
}> {
  const pathname = conversationBlobPathname(input.providerRecordingId);
  const fileStat = await stat(input.filePath);
  const storeId = blobStoreId();
  const token = blobToken();
  const uploaded = await put(pathname, createReadStream(input.filePath), {
    access: "private",
    contentType: "audio/mpeg",
    addRandomSuffix: false,
    allowOverwrite: true,
    multipart: fileStat.size > 4 * 1024 * 1024,
    storeId,
    token,
    cacheControlMaxAge: 60 * 60 * 24 * 30,
  });
  const metadata = await head(uploaded.url, { storeId, token });
  return {
    pathname: uploaded.pathname,
    url: uploaded.url,
    bytes: metadata.size,
    contentType: uploaded.contentType ?? "audio/mpeg",
  };
}

export async function issueConversationAudioUrl(pathname: string): Promise<{
  url: string;
  expires_at: string;
  ttl_ms: number;
}> {
  const ttlMs = CONVERSATION_AUDIO_URL_TTL_MS;
  const validUntil = Date.now() + ttlMs;
  const storeId = blobStoreId();
  const token = blobToken();
  const signed = await issueSignedToken({
    pathname,
    operations: ["get"],
    validUntil,
    storeId,
    token,
  });
  const { presignedUrl } = await presignUrl(
    {
      clientSigningToken: signed.clientSigningToken,
      delegationToken: signed.delegationToken,
    },
    {
      operation: "get",
      pathname,
      validUntil,
      access: "private",
    },
  );
  return {
    url: presignedUrl,
    expires_at: new Date(validUntil).toISOString(),
    ttl_ms: ttlMs,
  };
}
