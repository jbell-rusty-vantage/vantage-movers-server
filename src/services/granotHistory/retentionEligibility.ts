import { isDeepStrictEqual } from "node:util";
import type { ArchivedChain } from "./archiveCodec";
import type { ClosedOperation } from "./closedAutomationRun";

export function routineAutomationChain(
  c: ArchivedChain,
  cutoff: Date,
): boolean {
  const { observation: o, receipt: r, decisions: ds } = c,
    d = ds[0];
  return (
    ds.length === 1 &&
    d?.execution_mode === "live" &&
    (d.outcome === "already_current" ||
      (d.outcome === "stale" &&
        d.reason_code === "older_than_temporal_winner")) &&
    Array.isArray(d.effects) &&
    !d.effects.length &&
    r.observation_channel === "granot_http_automation" &&
    r.processing?.state === "completed" &&
    String(r.processing.latest_decision_id) === String(d._id) &&
    String(d.observation_id) === String(o._id) &&
    String(o.receipt_id) === String(r._id) &&
    o.kind === "lead_snapshot" &&
    o.priority?.valid === true &&
    !o.route_event_class &&
    !o.booking_action?.normalized &&
    typeof o.identity?.normalized_job_no === "string" &&
    !!o.identity.normalized_job_no &&
    [
      r.captured_at,
      r.processing.completed_at,
      o.captured_at,
      d.decided_at,
    ].every((v) => v instanceof Date && +v < +cutoff)
  );
}

export function matchesClosedReplay(
  chain: ArchivedChain,
  row: ClosedOperation | undefined | null,
) {
  const {
    receipt: r,
    observation: o,
    decisions: [d],
  } = chain;
  return (
    !!d &&
    !!row &&
    row.operation === r.channel_operation_id &&
    row.receipt === String(r._id) &&
    row.hash === r.payload_sha256 &&
    row.kind === r.channel_operation_kind &&
    row.result.observation_id === String(o._id) &&
    row.result.decision_id === String(d._id) &&
    row.result.outcome === d.outcome &&
    isDeepStrictEqual(row.result.effects, d.effects) &&
    isDeepStrictEqual(row.result.target, d.target)
  );
}

/** Retention bookkeeping is excluded from historical evidence and equality checks. */
export function archivalChain(c: ArchivedChain): ArchivedChain {
  const { retention_purge_at: _r, processing, ...receipt } = c.receipt;
  const {
    retention_review_at: _review,
    retention_reason: _reason,
    ...work
  } = processing;
  const { retention_purge_at: _o, ...observation } = c.observation;
  const decisions = c.decisions.map(
    ({ retention_purge_at: _d, ...decision }) => decision,
  );
  return { observation, receipt: { ...receipt, processing: work }, decisions };
}
