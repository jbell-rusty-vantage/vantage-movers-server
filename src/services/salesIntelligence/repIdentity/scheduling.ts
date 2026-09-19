import type { ClientSession } from "mongoose";
import { enqueueCsiJob } from "../jobs";
import { payloadHash } from "../transactions";
import { CsiError } from "../auth";

export type RepReevaluationWindow = { account: string; extension: string; from: Date; through: Date; change_id: string; after?: string; after_at?: Date };
/** Durable bounded page intent; each continuation commits with the page's effects. No provider or queue dependency. */
export async function scheduleRepIdentityReevaluation(window: RepReevaluationWindow, session: ClientSession) {
  if (!window.account.trim() || !window.extension.trim() || !Number.isFinite(+window.from) || !Number.isFinite(+window.through) || window.from > window.through ||
    !/^[a-f\d]{24}$/i.test(window.change_id) || Boolean(window.after) !== Boolean(window.after_at) ||
    (window.after && !/^[a-f\d]{24}$/i.test(window.after)) || (window.after_at && !Number.isFinite(+window.after_at))) throw new CsiError("INVALID_INPUT");
  const input = { ...window, from: window.from.toISOString(), through: window.through.toISOString(), after: window.after ?? null, after_at: window.after_at?.toISOString() ?? null };
  return enqueueCsiJob({ stage: "rep_identity_reevaluate", subject_key: `rep-extension:${payloadHash([window.account, window.extension])}`,
    dedupe_key: `csi:rep-reevaluate:${payloadHash(input)}`, input_revision: 1, input_refs: [window.change_id], rep_identity_window: input }, session);
}
