import { FileTokenStore } from "./file-token-store";
import { MongoTokenStore } from "./mongo-token-store";
import type { TokenStore } from "./types";

export type { TokenStore } from "./types";

export function createTokenStore(): TokenStore {
  const mode = process.env.RC_TOKEN_STORE?.trim().toLowerCase() ?? "file";
  if (mode === "mongo") {
    return new MongoTokenStore();
  }

  return new FileTokenStore(".ringcentral-token-cache.json");
}
