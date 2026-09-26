export const CSI_ENQUEUE_LOCAL_REPLICA_URI = "mongodb://127.0.0.1:27017/?replicaSet=rs0";

/** A destructive harness must not accept a caller-selected database target. */
export function csiEnqueueReplicaTarget(args: readonly string[]): string {
  if (args.length !== 2) {
    throw new Error("The enqueue test only runs against the documented local rs0 replica and accepts no arguments");
  }
  return CSI_ENQUEUE_LOCAL_REPLICA_URI;
}
