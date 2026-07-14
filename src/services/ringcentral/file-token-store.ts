import { promises as fs } from "node:fs";
import path from "node:path";
import type { RingCentralTokenCache, TokenStore } from "./types";

export class FileTokenStore implements TokenStore {
  private readonly filePath: string;

  constructor(filePath = ".ringcentral-token-cache.json") {
    this.filePath = path.resolve(process.cwd(), filePath);
  }

  async get(): Promise<RingCentralTokenCache | null> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return JSON.parse(raw) as RingCentralTokenCache;
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }
      throw error;
    }
  }

  async set(token: RingCentralTokenCache): Promise<void> {
    await fs.writeFile(this.filePath, `${JSON.stringify(token, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  }

  async del(): Promise<void> {
    try {
      await fs.unlink(this.filePath);
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
