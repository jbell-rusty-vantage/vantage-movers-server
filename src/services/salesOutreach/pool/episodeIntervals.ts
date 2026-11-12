type Episode<Id> = { subject_id: Id; event_at: { $gte: Date; $lt: Date } };

/** Subjects sharing a time window can use one indexed range without admitting events outside their episode. */
export function groupPoolEpisodeIntervals<Id>(intervals: readonly Episode<Id>[]) {
  const groups = new Map<string, { subject_id: { $in: Id[] }; event_at: Episode<Id>["event_at"] }>();
  for (const { subject_id, event_at } of intervals) {
    const key = String(+event_at.$gte) + "/" + String(+event_at.$lt);
    const group = groups.get(key);
    if (group) group.subject_id.$in.push(subject_id);
    else groups.set(key, { subject_id: { $in: [subject_id] }, event_at });
  }
  return [...groups.values()];
}
