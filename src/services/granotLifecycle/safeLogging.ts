const SAFE_CODE = /^[A-Z0-9][A-Z0-9_.-]{0,63}$/i;

export function granotLifecycleSafeErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code?: unknown }).code ?? "");
    if (SAFE_CODE.test(code)) return code;
  }
  return "technical_failure";
}

export function maskLifecycleId(value: string): string {
  const text = String(value);
  return text.length > 8 ? `${text.slice(0, 4)}…${text.slice(-4)}` : "…";
}

export function safeLifecycleFailureLog(input: {
  msg: string;
  error: unknown;
  receipt_id?: string;
  observation_channel?: string;
  route_event_class?: string;
}): Record<string, string> {
  return {
    msg: input.msg,
    error_code: granotLifecycleSafeErrorCode(input.error),
    ...(input.receipt_id ? { receipt_id: maskLifecycleId(input.receipt_id) } : {}),
    ...(input.observation_channel ? { observation_channel: input.observation_channel } : {}),
    ...(input.route_event_class ? { route_event_class: input.route_event_class } : {}),
  };
}
