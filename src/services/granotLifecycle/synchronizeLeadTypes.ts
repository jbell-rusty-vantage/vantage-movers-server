import type { ClientSession } from "mongoose";
import mongoose from "mongoose";
import type { GranotObservationDocument } from "../../models/GranotObservation";
import type { GranotRecordLinkDocument } from "../../models/GranotRecordLink";
import type {
  SynchronizationDecisionCandidate,
  SynchronizationDecisionSourceScope,
} from "../../models/SynchronizationDecision";
import type { GranotLifecycleFlags } from "../../config/domain/granotLifecycle";
import type { LeadIdentityResult, SynchronizationMatchMethod } from "./identity";
import type { LeadDesiredStateProjection } from "./leadDesiredState";
import type { EvaluatedGate } from "./sourcePolicy";
import type { EntityRef, ExecutionMode } from "./types";

export type SynchronizeLeadJobProposal = {
  normalized_job_no: string;
  job_no_snapshot: string;
  source_scope?: {
    lead_source_company: mongoose.Types.ObjectId;
    source_granularity_id: mongoose.Types.ObjectId;
  };
};

export type SynchronizeLeadExecution = {
  observation: GranotObservationDocument;
  identity: LeadIdentityResult;
  receipt_id: mongoose.Types.ObjectId;
  attempt: number;
  execution_mode: ExecutionMode;
  flags: GranotLifecycleFlags;
  evaluated_gates: EvaluatedGate[];
  match_method?: SynchronizationMatchMethod;
  candidates: SynchronizationDecisionCandidate[];
  source_scope?: SynchronizationDecisionSourceScope;
  job?: SynchronizeLeadJobProposal;
  decided_at: Date;
  target: EntityRef & { model: "FormLead" | "CallLead" };
  loadLead?: (
    target: EntityRef,
    session?: ClientSession,
  ) => Promise<LeadDesiredStateProjection | null>;
  findActiveLink?: (
    normalizedJobNo: string,
    session?: ClientSession,
  ) => Promise<GranotRecordLinkDocument | null>;
};
