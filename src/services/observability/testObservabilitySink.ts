import { isVantageTestRunner } from "../../config/domain/runtime";
import type { RecordOperationalEventInput } from "./recordOperationalEvent";

export type CapturedOperationalEvent = {
  input: RecordOperationalEventInput;
  capturedAt: Date;
};

type ObservabilityTestSinkState = {
  enabled: boolean;
  events: CapturedOperationalEvent[];
};

const SINK_KEY = Symbol.for("vantage.observability.testSink");

function getSinkState(): ObservabilityTestSinkState {
  const existing = Reflect.get(globalThis, SINK_KEY) as
    | ObservabilityTestSinkState
    | undefined;
  if (existing) {
    return existing;
  }

  const created: ObservabilityTestSinkState = {
    enabled: false,
    events: [],
  };
  Reflect.set(globalThis, SINK_KEY, created);
  return created;
}

export function installTestObservabilitySink(): void {
  const state = getSinkState();
  state.enabled = true;
  state.events.length = 0;
}

export function clearCapturedOperationalEvents(): void {
  getSinkState().events.length = 0;
}

export function getCapturedOperationalEvents(): CapturedOperationalEvent[] {
  return [...getSinkState().events];
}

export function isTestObservabilitySinkActive(): boolean {
  return isVantageTestRunner() || getSinkState().enabled;
}

export function captureOperationalEventForTest(
  input: RecordOperationalEventInput,
): void {
  if (!isTestObservabilitySinkActive()) {
    return;
  }

  getSinkState().events.push({
    input,
    capturedAt: new Date(),
  });
}
