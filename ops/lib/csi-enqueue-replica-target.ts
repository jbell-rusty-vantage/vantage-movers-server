export const CSI_ENQUEUE_LOCAL_REPLICA_URI = "mongodb://127.0.0.1:27189/?replicaSet=csi01";

/** A destructive harness must not accept a caller-selected database target. */
export function csiEnqueueReplicaTarget(args: readonly string[]): string {
  if (args.length !== 2) {
    throw new Error("The enqueue test only runs against the documented local csi01 loopback replica and accepts no arguments");
  }
  return CSI_ENQUEUE_LOCAL_REPLICA_URI;
}
