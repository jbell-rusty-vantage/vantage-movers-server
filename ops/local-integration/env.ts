/**
 * Side-effect module: import it FIRST in a helper that loads server code. It reads `--database=` and
 * points this process at that local test database before any `src/` module reads the environment.
 */
import { localTestDatabase, useLocalReplica } from "./local-target";

export const database = localTestDatabase(process.argv.slice(2));
useLocalReplica(database);
