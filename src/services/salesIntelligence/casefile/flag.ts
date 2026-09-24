import { csiFlag } from "../../../config/domain/salesIntelligence";
/**
 * `SALES_INTELLIGENCE_CASE_FILE` (Attention and Case File spec §4.11), default off, read the way every
 * CSI flag is read (`csiFlag`: the exact string `true`). It is read once per run, at prepare time,
 * through `structuredStepContracts()`, and recorded in the run's `step_contracts` (`layout`), so a run
 * never switches layout mid-flight and a replay keeps the layout it was asked with.
 */
export const CASE_FILE_FLAG = "SALES_INTELLIGENCE_CASE_FILE";
export const caseFileEnabled = () => csiFlag("CASE_FILE");
