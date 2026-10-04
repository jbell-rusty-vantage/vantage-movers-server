import assert from "node:assert/strict";
import { test } from "node:test";
import { CSI_ENQUEUE_LOCAL_REPLICA_URI, csiEnqueueReplicaTarget } from "./csi-enqueue-replica-target";

test("CSI enqueue replica harness rejects caller-selected targets", () => {
  assert.equal(csiEnqueueReplicaTarget(["node", "ops/test-csi-enqueue-replica.ts"]), CSI_ENQUEUE_LOCAL_REPLICA_URI);
  // The only replica this machine runs (and the only database a harness may write to) is loopback csi01:27189.
  assert.equal(CSI_ENQUEUE_LOCAL_REPLICA_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  assert.throws(
    () => csiEnqueueReplicaTarget(["node", "ops/test-csi-enqueue-replica.ts", "mongodb://127.0.0.1:27029/?replicaSet=enqueue"]),
    /accepts no arguments/,
  );
});
