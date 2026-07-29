import { connectMongo } from "../../../db";
import {
  OperationsRegistryChange,
  type OperationsRegistryChangeDocument,
} from "../../../models/OperationsRegistryChange";
import type { ListRegistryChangesQuery, ListRegistryChangesResult, RegistryChangeListItem } from "../types";
import { sanitizeRegistryMetadata, sanitizeRegistrySnapshot } from "../snapshotSanitizer";

function toListItem(doc: OperationsRegistryChangeDocument): RegistryChangeListItem {
  return {
    id: doc._id.toString(),
    entity_type: doc.entity_type,
    entity_id: doc.entity_id,
    action: doc.action,
    actor_type: doc.actor_type,
    actor_id: doc.actor_id,
    actor_label: doc.actor_label,
    actor_role: doc.actor_role,
    request_id: doc.request_id,
    reason: doc.reason ?? null,
    before: sanitizeRegistrySnapshot(doc.before as Record<string, unknown> | null),
    after: sanitizeRegistrySnapshot(doc.after as Record<string, unknown> | null),
    metadata: sanitizeRegistryMetadata(doc.metadata as Record<string, unknown>),
    created_at: doc.created_at.toISOString(),
  };
}

function buildFilter(query: ListRegistryChangesQuery): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (query.entity_type) {
    filter.entity_type = query.entity_type;
  }
  if (query.entity_id) {
    filter.entity_id = query.entity_id;
  }
  if (query.actor_id) {
    filter.actor_id = query.actor_id;
  }
  if (query.action) {
    filter.action = query.action;
  }
  if (query.request_id) {
    filter.request_id = query.request_id;
  }
  if (query.from || query.to) {
    filter.created_at = {
      ...(query.from ? { $gte: query.from } : {}),
      ...(query.to ? { $lte: query.to } : {}),
    };
  }
  return filter;
}

export async function listRegistryChanges(
  query: ListRegistryChangesQuery,
): Promise<ListRegistryChangesResult> {
  await connectMongo();

  const page = query.page ?? 1;
  const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
  const skip = (page - 1) * limit;
  const filter = buildFilter(query);

  const [items, total] = await Promise.all([
    OperationsRegistryChange.find(filter)
      .sort({ created_at: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean<OperationsRegistryChangeDocument[]>(),
    OperationsRegistryChange.countDocuments(filter),
  ]);

  return {
    items: items.map(toListItem),
    page,
    limit,
    total,
    has_next_page: skip + items.length < total,
  };
}
