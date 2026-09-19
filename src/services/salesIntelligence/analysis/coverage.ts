import { readContentSchema } from "./reads";

/** Coverage validation is about paginated processing, not quotation/entailment verification. */
export function capturedTranscriptsComplete(snapshots: Array<{ response: unknown; arguments: unknown }>, conversationId: string | null) {
  const pages = snapshots.map(snapshot => ({ data: readContentSchema.parse(snapshot.response), args: snapshot.arguments }))
    .filter(page => page.data.transcript);
  // A number synthesis has no single conversation to require, but it still needs
  // at least one captured transcript before its summary can be published.
  if (!pages.length) return false;
  if (conversationId && !pages.some(p => p.data.transcript!.conversation_id === conversationId)) return false;
  const groups = new Map<string, typeof pages>();
  for (const page of pages) {
    const id = page.data.transcript!.conversation_id;
    groups.set(id, [...(groups.get(id) ?? []), page]);
  }
  for (const group of groups.values()) {
    if (new Set(group.map(p => p.data.transcript!.source_snapshot_id)).size !== 1) return false;
    const cursor = (args: unknown) => args && typeof args === "object" && "cursor" in args ? args.cursor : undefined;
    let current = group.find(p => cursor(p.args) === undefined);
    const seen = new Set<typeof current>();
    while (current) {
      if (seen.has(current)) return false;
      seen.add(current);
      const page = current.data.page;
      if (page.missing_ranges.some(r => !/^segments_(before|after):\d+$/.test(r))) return false;
      if (!page.complete && !page.missing_ranges.length) return false;
      if (!page.next_cursor) break;
      current = group.find(p => cursor(p.args) === page.next_cursor);
    }
    if (!current) return false;
  }
  return true;
}
