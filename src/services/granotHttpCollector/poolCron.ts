import { estimatesCronDecision, estimatesDateWindow, granotCalendarEpoch, newYorkHour } from './estimatesCron';

export type EstimatesLane = 'all' | 'pool_refresh' | 'pool_discovery';
export type PoolLane = Exclude<EstimatesLane, 'all'>;
export const POOL_DISCOVERY_FLOOR = '01/01/2020';

export type PoolDuty = { run: true; lane: PoolLane; slotKey: string; dateWindow: { from: string; to: string } };

/** Independent duties: 06:00 has both refresh and discovery. */
export function poolCronDuties(now: Date): PoolDuty[] {
  const recent = estimatesDateWindow(now), hour = newYorkHour(now);
  const duties: PoolDuty[] = [];
  if (estimatesCronDecision(now).run) duties.push({ run: true, lane: 'pool_refresh', slotKey: `${recent.to}:${hour}:pool_refresh`, dateWindow: recent });
  if (hour === 6) duties.push({ run: true, lane: 'pool_discovery', slotKey: `${recent.to}:6:pool_discovery`, dateWindow: { from: POOL_DISCOVERY_FLOOR, to: recent.to } });
  return duties;
}

/** Compatibility for callers selecting one lane; dispatchers must consume all duties. */
export function poolCronDecision(now: Date): PoolDuty | { run: false; reason: 'outside_pool_hours' } {
  return poolCronDuties(now).at(-1) ?? { run: false, reason: 'outside_pool_hours' };
}

export function poolLatestSlot(now: Date, lane: PoolLane): { slotKey: string; at: Date } {
  let at = new Date(Math.floor(+now / 3_600_000)*3_600_000);
  for (let i=0;i<27;i++,at=new Date(+at-3_600_000)) {
    const duty = poolCronDuties(at).find(duty => duty.lane === lane);
    if (duty) return {slotKey:duty.slotKey,at};
  }
  throw new Error('Pool schedule did not contain a recent slot');
}

/** Bounded historical Pool partitions; adaptive collector splitting remains authoritative. */
export function poolDiscoveryDateChunks(window: { from: string; to: string }): Array<{ from: string; to: string }> {
  const first=granotCalendarEpoch(window.from),last=granotCalendarEpoch(window.to),day=86400000;
  if(last<first)throw new Error('Invalid Pool discovery date window');
  const format=(at:number)=>{const d=new Date(at);return `${String(d.getUTCMonth()+1).padStart(2,'0')}/${String(d.getUTCDate()).padStart(2,'0')}/${d.getUTCFullYear()}`;};
  const result=[];
  for(let start=first;start<=last;start+=31*day)result.push({from:format(start),to:format(Math.min(last,start+30*day))});
  return result;
}
