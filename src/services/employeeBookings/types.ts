import type mongoose from "mongoose";
import type {
  BookingLeadReconciliationReason,
  EmployeeBookingAutoMatchRule,
} from "../../config/domain";

export type SourceAssignmentSnapshot = {
  lead_source_company: mongoose.Types.ObjectId;
  source_granularity_id: mongoose.Types.ObjectId;
  source_granularity_key: string;
  source_company: string;
  source_company_label_snapshot: string;
  source_granularity_label_snapshot: string;
  crm_source_label_snapshot: string;
  channel: "form" | "call";
};

export type PreparedEmployeeBookingSubmission = {
  submissionId: string;
  leadName: string;
  normalizedLeadName?: string;
  phoneNumber: string;
  normalizedPhoneNumber: string;
  email?: string;
  normalizedEmail?: string;
  lid?: string;
  normalizedLid?: string;
  jobNo: string;
  normalizedJobNo: string;
  binderAmount: number;
  depositAmount: number;
  merchant: string;
  agent: string;
  splitAgent?: string;
  bookDate: Date;
  sourceAssignment: SourceAssignmentSnapshot;
  sourceDisplayLabel: string;
  local?: "local" | "long_distance";
  agentAllocations: Array<{
    agent: mongoose.Types.ObjectId;
    agent_name_snapshot: string;
    binder_amount: number;
  }>;
};

export type CandidateMatchMethod =
  | "lid"
  | "job_no"
  | "phone"
  | "email"
  | "normalized_name";

export type CandidateEligibility =
  | "eligible"
  | "duplicate"
  | "booked"
  | "cancelled";

export type EvaluatedLeadCandidate = {
  leadId: string;
  leadModel: "FormLead" | "CallLead";
  confidence: "high" | "medium" | "low";
  matchMethods: CandidateMatchMethod[];
  eligibility: CandidateEligibility;
  sourceCompatibility:
    | "exact_granularity"
    | "same_company"
    | "unassigned"
    | "conflict";
  warnings: string[];
  snapshot: {
    name?: string;
    phone_number?: string;
    email?: string;
    lid?: string;
    job_no?: string;
    source_company?: string;
    source_granularity_key?: string;
    booked?: string;
    cancelled?: string;
    duplicate?: boolean;
    ingested_contact_snapshot?: {
      name?: string;
      first_name?: string;
      last_name?: string;
      phone_number?: string;
      email?: string;
      differs_from_ingested?: boolean;
      captured_at?: string;
    };
    granot_contact_snapshot?: {
      name?: string;
      first_name?: string;
      last_name?: string;
      phone_number?: string;
      email?: string;
      differs_from_ingested?: boolean;
      captured_at?: string;
    };
  };
};

export type EmployeeBookingCandidateQueryResult = {
  candidates: EvaluatedLeadCandidate[];
  /**
   * At least one matching query produced more candidates than we retain. An
   * auto-match must never treat a truncated set as proof of uniqueness.
   */
  hasOverflow: boolean;
};

export type EmployeeBookingMatchOutcome =
  | {
      kind: "linked";
      leadId: string;
      leadModel: "FormLead" | "CallLead";
      rule: EmployeeBookingAutoMatchRule;
      candidates: EvaluatedLeadCandidate[];
      reason: "high_confidence";
    }
  | {
      kind: "pending";
      reason: BookingLeadReconciliationReason;
      candidates: EvaluatedLeadCandidate[];
    };

export type MatchAttemptTrigger = "initial" | "delayed_retry" | "owner_refresh";

export type EmployeeBookingActorContext = {
  actor: string;
  ownerId?: string;
  ownerEmail?: string;
};
