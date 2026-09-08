import { isVantageTestRunner } from "../../config/domain/runtime";
import type { RecordDailyOperationsFactInput } from "./recordDailyOperationsFact";

export type CapturedDailyOperationsFact = {
  input: RecordDailyOperationsFactInput;
  capturedAt: Date;
};

type DailyOperationsTestSinkState = {
  enabled: boolean;
  facts: CapturedDailyOperationsFact[];
};

const SINK_KEY = Symbol.for("vantage.dailyOperations.testSink");

function getSinkState(): DailyOperationsTestSinkState {
  const existing = Reflect.get(globalThis, SINK_KEY) as
    | DailyOperationsTestSinkState
    | undefined;
  if (existing) {
    return existing;
  }

  const created: DailyOperationsTestSinkState = {
    enabled: false,
    facts: [],
  };
  Reflect.set(globalThis, SINK_KEY, created);
  return created;
}

export function installTestDailyOperationsSink(): void {
  const state = getSinkState();
  state.enabled = true;
  state.facts.length = 0;
}

export function clearCapturedDailyOperationsFacts(): void {
  getSinkState().facts.length = 0;
}

export function getCapturedDailyOperationsFacts(): CapturedDailyOperationsFact[] {
  return [...getSinkState().facts];
}

export function isTestDailyOperationsSinkActive(): boolean {
  return isVantageTestRunner() || getSinkState().enabled;
}

export function captureDailyOperationsFactForTest(
  input: RecordDailyOperationsFactInput,
): void {
  if (!isTestDailyOperationsSinkActive()) {
    return;
  }

  getSinkState().facts.push({
    input,
    capturedAt: new Date(),
  });
}
