import { MongoClient, ObjectId } from "mongodb";
import { CLOUD_STORAGE_NAMESPACES, createFakeObjectStore } from "../cloudStorage";
import { granotArchiveStorage } from "./archiveObjects";

/** The Granot history namespace (holds, reuse, 800 s review) over an in-memory fake bucket. */
export function fakeGranotArchive(now?: () => Date) {
  const ns = CLOUD_STORAGE_NAMESPACES["granot-history"];
  const { store, bucket } = createFakeObjectStore({ prefix: ns.prefix, holdKeys: ns.holdKeys, reuse: ns.reuse, review: ns.review, now });
  return { store, bucket, storage: granotArchiveStorage(store) };
}

const LOCAL_REPLICA = "mongodb://127.0.0.1:27189/?replicaSet=csi01";

/**
 * A disposable database on the loopback `csi01` replica, for proofs that need real transactions.
 * Opt-in with GRANOT_LIFECYCLE_REPLICA_TESTS=true; the caller drops the database and closes the client.
 */
export async function historyReplica(t: { skip: (reason: string) => void }, label: string) {
  if (process.env.GRANOT_LIFECYCLE_REPLICA_TESTS !== "true") {
    t.skip("Replica proof is opt-in (GRANOT_LIFECYCLE_REPLICA_TESTS=true).");
    return null;
  }
  const client = new MongoClient(LOCAL_REPLICA, { serverSelectionTimeoutMS: 3000 });
  const db = client.db(`testvantagemovers_${label}${new ObjectId()}`);
  const hello = await db.admin().command({ hello: 1 });
  if (hello.setName !== "csi01") throw new Error("Expected the loopback csi01 replica");
  return { client, db };
}
