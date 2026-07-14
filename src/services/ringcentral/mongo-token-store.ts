import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../config/domain";
import { connectMongo } from "../../db";
import type { RingCentralTokenCache, TokenStore } from "./types";

const TOKEN_KEY = "ringcentral:oauth-token";
const COLLECTION_NAME = "integration_tokens";

type IntegrationTokenDocument = RingCentralTokenCache & {
  key: typeof TOKEN_KEY;
  updated_at: Date;
  access_token_expires_at_date: Date;
  refresh_token_expires_at_date?: Date | null;
};

export class MongoTokenStore implements TokenStore {
  private indexesReady: Promise<void> | null = null;

  async get(): Promise<RingCentralTokenCache | null> {
    const collection = await this.getCollection();
    const document = await collection.findOne({ key: TOKEN_KEY });
    if (!document) {
      return null;
    }

    return {
      access_token: document.access_token,
      refresh_token: document.refresh_token,
      token_type: document.token_type,
      scope: document.scope,
      owner_id: document.owner_id,
      endpoint_id: document.endpoint_id,
      issued_at: document.issued_at,
      access_token_expires_at: document.access_token_expires_at,
      refresh_token_expires_at: document.refresh_token_expires_at,
      raw: document.raw,
    };
  }

  async set(token: RingCentralTokenCache): Promise<void> {
    const collection = await this.getCollection();
    const refreshTokenExpiresAt = token.refresh_token_expires_at ?? null;

    await collection.updateOne(
      { key: TOKEN_KEY },
      {
        $set: {
          ...token,
          key: TOKEN_KEY,
          updated_at: new Date(),
          access_token_expires_at_date: new Date(token.access_token_expires_at),
          refresh_token_expires_at_date: refreshTokenExpiresAt
            ? new Date(refreshTokenExpiresAt)
            : null,
        },
      },
      { upsert: true },
    );
  }

  async del(): Promise<void> {
    const collection = await this.getCollection();
    await collection.deleteOne({ key: TOKEN_KEY });
  }

  private async getCollection() {
    await connectMongo();
    await this.ensureIndexes();

    const db = mongoose.connection.useDb(getMongoDatabaseName(), {
      useCache: true,
    }).db;
    if (!db) {
      throw new Error("MongoDB connection is not ready");
    }

    return db.collection<IntegrationTokenDocument>(COLLECTION_NAME);
  }

  private ensureIndexes(): Promise<void> {
    this.indexesReady ??= this.createIndexes();
    return this.indexesReady;
  }

  private async createIndexes(): Promise<void> {
    await connectMongo();
    const db = mongoose.connection.useDb(getMongoDatabaseName(), {
      useCache: true,
    }).db;
    if (!db) {
      throw new Error("MongoDB connection is not ready");
    }

    const collection = db.collection<IntegrationTokenDocument>(COLLECTION_NAME);
    await collection.createIndex({ key: 1 }, { unique: true });
    await collection.createIndex(
      { refresh_token_expires_at_date: 1 },
      { expireAfterSeconds: 0 },
    );
  }
}
