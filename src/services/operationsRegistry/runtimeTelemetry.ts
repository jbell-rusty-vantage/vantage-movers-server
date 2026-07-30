import { recordOperationalEvent } from "../observability";

export type RegistryResolverName = "source" | "cpl" | "ringcentral";
export type RegistryResolverMode = "direct_db" | "snapshot";
export type RegistryCompatibilityConsumer =
  | "admin_list"
  | "booking_legacy_parse"
  | "enrichment"
  | "reconciliation"
  | "unknown";

type ResolverState = {
  mode: RegistryResolverMode;
  lastSuccessAt?: Date;
  maxAgeMs?: number;
  refreshAttempts: number;
  refreshFailures: number;
  lastErrorCode?: string;
  servingStale: boolean;
};

export type RegistryResolverTelemetry = {
  mode: RegistryResolverMode;
  last_success_at: string | null;
  age_ms: number | null;
  max_age_ms: number | null;
  refresh_attempts: number;
  refresh_failures: number;
  last_error_code: string | null;
  serving_stale: boolean;
};

export type RegistryCompatibilityTelemetry = {
  path: string;
  consumer_category: RegistryCompatibilityConsumer;
  count: number;
  last_used_at: string;
};

export type RegistryRuntimeTelemetry = {
  resolvers: Record<RegistryResolverName, RegistryResolverTelemetry>;
  compatibility_reads: RegistryCompatibilityTelemetry[];
};

const resolverStates: Record<RegistryResolverName, ResolverState> = {
  source: initialResolverState("direct_db"),
  cpl: initialResolverState("direct_db"),
  ringcentral: initialResolverState("snapshot"),
};
const compatibilityReads = new Map<
  string,
  { path: string; consumer: RegistryCompatibilityConsumer; count: number; lastUsedAt: Date }
>();

export function recordRegistryResolverAttempt(name: RegistryResolverName): void {
  resolverStates[name].refreshAttempts += 1;
}

export function recordRegistryResolverSuccess(
  name: RegistryResolverName,
  options: { loadedAt?: Date; maxAgeMs?: number } = {},
): void {
  const state = resolverStates[name];
  state.lastSuccessAt = new Date(options.loadedAt ?? new Date());
  state.maxAgeMs = options.maxAgeMs;
  state.lastErrorCode = undefined;
  state.servingStale = false;
}

export function recordRegistryResolverFailure(
  name: RegistryResolverName,
  safeErrorCode: string,
): void {
  const state = resolverStates[name];
  state.refreshFailures += 1;
  state.lastErrorCode = safeErrorCode;
}

export function recordRegistryResolverStaleServe(name: RegistryResolverName): void {
  resolverStates[name].servingStale = true;
}

export function recordCompatibilityRead(
  path: string,
  consumer: RegistryCompatibilityConsumer,
  usedAt = new Date(),
): void {
  const key = `${path}:${consumer}`;
  const current = compatibilityReads.get(key);
  compatibilityReads.set(key, {
    path,
    consumer,
    count: (current?.count ?? 0) + 1,
    lastUsedAt: new Date(usedAt),
  });
}

export async function recordDurableCompatibilityRead(
  path: string,
  consumer: RegistryCompatibilityConsumer,
  usedAt = new Date(),
): Promise<void> {
  try {
    const persisted = await recordOperationalEvent({
      level: "info",
      eventKey: "operations_registry.compatibility_read",
      category: "admin",
      workflow: "operations_registry",
      summary: "A retained Operations Registry compatibility path was read.",
      details: {
        compatibility_path: path,
        consumer_category: consumer,
      },
      occurredAt: usedAt,
      notificationCandidate: false,
      ownerVisible: true,
      reportable: false,
      piiPolicy: "none",
    });
    if (!persisted) {
      recordCompatibilityRead(path, consumer, usedAt);
    }
  } catch {
    // Compatibility telemetry must never make a retained read unavailable.
    recordCompatibilityRead(path, consumer, usedAt);
  }
}

export function getRegistryRuntimeTelemetry(
  now = new Date(),
): RegistryRuntimeTelemetry {
  return {
    resolvers: {
      source: resolverView(resolverStates.source, now),
      cpl: resolverView(resolverStates.cpl, now),
      ringcentral: resolverView(resolverStates.ringcentral, now),
    },
    compatibility_reads: [...compatibilityReads.values()]
      .map((item) => ({
        path: item.path,
        consumer_category: item.consumer,
        count: item.count,
        last_used_at: item.lastUsedAt.toISOString(),
      }))
      .sort(
        (left, right) =>
          left.path.localeCompare(right.path) ||
          left.consumer_category.localeCompare(right.consumer_category),
      ),
  };
}

export function mergeDurableCompatibilityTelemetry(
  telemetry: RegistryRuntimeTelemetry,
  events: readonly {
    path: string;
    consumer_category: RegistryCompatibilityConsumer;
    occurred_at: Date;
  }[],
): RegistryRuntimeTelemetry {
  const merged = new Map(
    telemetry.compatibility_reads.map((item) => [
      `${item.path}:${item.consumer_category}`,
      { ...item },
    ]),
  );
  for (const event of events) {
    const key = `${event.path}:${event.consumer_category}`;
    const current = merged.get(key);
    const occurredAt = event.occurred_at.toISOString();
    merged.set(key, {
      path: event.path,
      consumer_category: event.consumer_category,
      count: (current?.count ?? 0) + 1,
      last_used_at:
        !current || occurredAt > current.last_used_at
          ? occurredAt
          : current.last_used_at,
    });
  }
  return {
    ...telemetry,
    compatibility_reads: [...merged.values()].sort(
      (left, right) =>
        left.path.localeCompare(right.path) ||
        left.consumer_category.localeCompare(right.consumer_category),
    ),
  };
}

export function resetRegistryRuntimeTelemetryForTests(): void {
  resolverStates.source = initialResolverState("direct_db");
  resolverStates.cpl = initialResolverState("direct_db");
  resolverStates.ringcentral = initialResolverState("snapshot");
  compatibilityReads.clear();
}

function initialResolverState(mode: RegistryResolverMode): ResolverState {
  return {
    mode,
    refreshAttempts: 0,
    refreshFailures: 0,
    servingStale: false,
  };
}

function resolverView(
  state: ResolverState,
  now: Date,
): RegistryResolverTelemetry {
  return {
    mode: state.mode,
    last_success_at: state.lastSuccessAt?.toISOString() ?? null,
    age_ms: state.lastSuccessAt
      ? Math.max(0, now.getTime() - state.lastSuccessAt.getTime())
      : null,
    max_age_ms: state.maxAgeMs ?? null,
    refresh_attempts: state.refreshAttempts,
    refresh_failures: state.refreshFailures,
    last_error_code: state.lastErrorCode ?? null,
    serving_stale: state.servingStale,
  };
}
