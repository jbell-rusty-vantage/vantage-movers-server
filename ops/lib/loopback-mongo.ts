/**
 * Loopback detection for Mongo URIs. Replica harnesses and the slimming rehearsal refuse any target whose hosts
 * are not all loopback (`127.0.0.1` / `localhost`), and every `mongodb+srv` URI (SRV always resolves remotely).
 */
export function isLoopbackMongoUri(uri: string): boolean {
  const match = uri.trim().match(/^mongodb:\/\/(?:[^@/]*@)?([^/?]+)/i);
  if (!match) return false;
  return match[1]!.split(",").every((host) => /^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host.trim()));
}
