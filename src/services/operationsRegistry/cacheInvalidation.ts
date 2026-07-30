type RegistryCacheInvalidationListener = (keys: readonly string[]) => void;

const listeners = new Set<RegistryCacheInvalidationListener>();
const invalidationLog: string[][] = [];

export function onRegistryCacheInvalidation(
  listener: RegistryCacheInvalidationListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function invalidateRegistryCaches(keys: readonly string[]): void {
  const uniqueKeys = [...new Set(keys.filter(Boolean))];
  if (uniqueKeys.length === 0) {
    return;
  }
  invalidationLog.push(uniqueKeys);
  for (const listener of listeners) {
    listener(uniqueKeys);
  }
}

export function getRegistryCacheInvalidationLogForTests(): readonly (readonly string[])[] {
  return invalidationLog;
}

export function resetRegistryCacheInvalidationForTests(): void {
  listeners.clear();
  invalidationLog.length = 0;
}
