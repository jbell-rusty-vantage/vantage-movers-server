/** Retired consumer seam: delayed deliveries perform no Mongo, source or domain work. */
export async function runBestRelocationIngestionWorker(): Promise<{
  claimed: boolean; run_id?: string; status?: string;
}> { return { claimed: false, status: "retired" }; }
