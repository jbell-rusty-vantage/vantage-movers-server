/** Production DDL needs an explicit operator acknowledgement before Mongo connects. */
export const ATTENTION_STORAGE_PRODUCTION_FLAG = "--allow-production";

export function attentionStorageIndexProductionRefusal(database: string, argv: readonly string[]): string | null {
  if (database !== "vantagemovers" || argv.includes(ATTENTION_STORAGE_PRODUCTION_FLAG)) return null;
  return `Refusing to create Attention artifact indexes against production without ${ATTENTION_STORAGE_PRODUCTION_FLAG}`;
}
