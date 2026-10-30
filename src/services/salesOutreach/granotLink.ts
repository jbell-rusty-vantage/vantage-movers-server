import type { OutreachActor } from "./auth";
import type { DeskReadDeps } from "./reads/common";
import { OutreachError } from "./errors";

/** Owner pause: never look up or return a Granot URL while browser account identity is unresolved. */
export async function resolveOutreachGranotLink(_actor: OutreachActor, _subjectId: string, _refresh: boolean, _deps: DeskReadDeps): Promise<never> {
  throw new OutreachError("SERVICE_UNAVAILABLE", [{ path: "granot_link", code: "auth_fix_pending", message: "Attempting auth fix." }]);
}
