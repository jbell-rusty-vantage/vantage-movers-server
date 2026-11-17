import { MongoClient, type Db } from "mongodb";
import { assertLocalHello, assertLocalIdentity, type LocalIdentity } from "./local-safety";

export async function withLocalDatabase<T>(identity: LocalIdentity, read: (db: Db) => Promise<T>): Promise<T> {
  assertLocalIdentity(identity);
  const client = new MongoClient(identity.uri, {
    maxPoolSize: 1, serverSelectionTimeoutMS: 2_000, connectTimeoutMS: 2_000,
    socketTimeoutMS: 3_000, readPreference: "primary", retryReads: false,
  });
  try {
    await client.connect();
    assertLocalHello(await client.db("admin").command({ hello: 1 }), identity);
    return await read(client.db(identity.database));
  } finally { await client.close(); }
}
