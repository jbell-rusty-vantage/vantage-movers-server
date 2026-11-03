/** Permanent runtime fence. Final reconciliation uses archived operator tooling. */
export const BEST_RELOCATION_RETIRED = true;
export const BEST_RELOCATION_RETIRED_CODE = "BEST_RELOCATION_RETIRED";
export function bestRelocationRetiredError(): Error & { status: number; code: string } {
  return Object.assign(new Error("Best Relocation ingestion is permanently retired."), {
    status: 410, code: BEST_RELOCATION_RETIRED_CODE,
  });
}
