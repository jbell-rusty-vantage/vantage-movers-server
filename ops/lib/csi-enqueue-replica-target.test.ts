import assert from "node:assert/strict";
import { test } from "node:test";
import { CSI_ENQUEUE_LOCAL_REPLICA_URI, csiEnqueueReplicaTarget } from "./csi-enqueue-replica-target";

test("CSI enqueue replica harness rejects caller-selected targets", () => {
  assert.equal(csiEnqueueReplicaTarget(["node", "ops/test-csi-enqueue-replica.ts"]), CSI_ENQUEUE_LOCAL_REPLICA_URI);
  assert.throws(
    () => csiEnqueueReplicaTarget(["node", "ops/test-csi-enqueue-replica.ts", "mongodb://127.0.0.1:27029/?replicaSet=enqueue"]),
    /accepts no arguments/,
  );
});
