import { activity } from './state.mjs';

export function checkpointDue({ eventList, snapshot, previous, stableSince, config, now = Date.now() }) {
  const { active, latest } = activity(eventList);
  if (!latest || active) return null;
  const wait = latest.event === 'end' ? config.endGraceSeconds * 1000 : config.idleMinutes * 60_000;
  if (now - Math.max(stableSince, latest.at) < wait) return null;
  if (previous?.inputFingerprint === snapshot.fingerprint && ['failed', 'patch-ready'].includes(previous.status)) return null;
  return latest.event === 'end' ? 'session-end' : 'inactivity';
}
