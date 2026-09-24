import { getOutreachRecordModel, OUTREACH_RECORD_INDEXES } from "./outreach";
import {
  getOutreachFollowupModel,
  OUTREACH_FOLLOWUP_INDEXES,
} from "./outreach";
import {
  getSalesIntelligenceJobModel,
  SALES_INTELLIGENCE_JOB_INDEXES,
} from "./infrastructure";
import {
  getSalesIntelligenceAuditEventModel,
  SALES_INTELLIGENCE_AUDIT_EVENT_INDEXES,
} from "./infrastructure";
import {
  getSalesIntelligenceCommandExecutionModel,
  SALES_INTELLIGENCE_COMMAND_EXECUTION_INDEXES,
} from "./infrastructure";
import {
  getSalesIntelligenceAiBudgetModel,
  SALES_INTELLIGENCE_AI_BUDGET_INDEXES,
} from "./infrastructure";
import {
  getSalesIntelligenceAiReservationModel,
  SALES_INTELLIGENCE_AI_RESERVATION_INDEXES,
} from "./infrastructure";
import {
  getSalesIntelligencePolicyVersionModel,
  SALES_INTELLIGENCE_POLICY_VERSION_INDEXES,
} from "./infrastructure";
import {
  getSalesIntelligencePolicyPointerModel,
  SALES_INTELLIGENCE_POLICY_POINTER_INDEXES,
} from "./infrastructure";
import {
  getSalesIntelligenceAttentionSnapshotModel,
  SALES_INTELLIGENCE_ATTENTION_SNAPSHOT_INDEXES,
} from "./infrastructure";
import {
  getIntelligenceRunModel,
  INTELLIGENCE_RUN_INDEXES,
} from "./intelligence";
import {
  getIntelligenceEvidenceSnapshotModel,
  INTELLIGENCE_EVIDENCE_SNAPSHOT_INDEXES,
} from "./intelligence";
import {
  getIntelligenceSubmissionModel,
  INTELLIGENCE_SUBMISSION_INDEXES,
} from "./intelligence";
import {
  getIntelligenceFindingModel,
  INTELLIGENCE_FINDING_INDEXES,
} from "./intelligence";
import {
  getIntelligenceEffectModel,
  INTELLIGENCE_EFFECT_INDEXES,
} from "./intelligence";
import {
  getSalesIntelligenceOwnerInstructionModel,
  SALES_INTELLIGENCE_OWNER_INSTRUCTION_INDEXES,
} from "./intelligence";
import {
  getIntelligenceOwnerAssessmentModel,
  INTELLIGENCE_OWNER_ASSESSMENT_INDEXES,
} from "./intelligence";
import {
  getSalesIntelligenceReviewItemModel,
  SALES_INTELLIGENCE_REVIEW_ITEM_INDEXES,
} from "./intelligence";
import {
  getSalesIntelligenceContactRestrictionModel,
  SALES_INTELLIGENCE_CONTACT_RESTRICTION_INDEXES,
} from "./intelligence";
import {
  getCallInteractionAliasModel,
  CALL_INTERACTION_ALIAS_INDEXES,
} from "./capture";
import {
  getRingCentralDirectorySnapshotModel,
  RING_CENTRAL_DIRECTORY_SNAPSHOT_INDEXES,
} from "./capture";
import {
  getSalesIntelligenceSyncStateModel,
  SALES_INTELLIGENCE_SYNC_STATE_INDEXES,
} from "./capture";
import {
  getSalesIntelligenceSyncWindowModel,
  SALES_INTELLIGENCE_SYNC_WINDOW_INDEXES,
} from "./capture";
import {
  getMoveAssessmentArtifactModel,
  MOVE_ASSESSMENT_ARTIFACT_INDEXES,
} from "./assessment";
import {
  getContactNumberModel,
  CONTACT_NUMBER_INDEXES,
} from "../ContactNumber";
import {
  getCallInteractionModel,
  CALL_INTERACTION_INDEXES,
} from "../CallInteraction";
import {
  getNumberLeadAttachmentModel,
  NUMBER_LEAD_ATTACHMENT_INDEXES,
} from "../NumberLeadAttachment";
import {
  getRepIdentityLinkModel,
  REP_IDENTITY_LINK_INDEXES,
} from "../RepIdentityLink";
import {
  getOwnerRepNudgeModel,
  OWNER_REP_NUDGE_INDEXES,
} from "../OwnerRepNudge";
import { getOutreachRepDayModel, OUTREACH_REP_DAY_INDEXES } from "./overview";
export const CSI_MODEL_REGISTRY = [
  {
    name: "OutreachRecord",
    model: getOutreachRecordModel,
    indexes: OUTREACH_RECORD_INDEXES,
  },
  {
    name: "OutreachFollowup",
    model: getOutreachFollowupModel,
    indexes: OUTREACH_FOLLOWUP_INDEXES,
  },
  {
    name: "SalesIntelligenceJob",
    model: getSalesIntelligenceJobModel,
    indexes: SALES_INTELLIGENCE_JOB_INDEXES,
  },
  {
    name: "SalesIntelligenceAuditEvent",
    model: getSalesIntelligenceAuditEventModel,
    indexes: SALES_INTELLIGENCE_AUDIT_EVENT_INDEXES,
  },
  {
    name: "SalesIntelligenceCommandExecution",
    model: getSalesIntelligenceCommandExecutionModel,
    indexes: SALES_INTELLIGENCE_COMMAND_EXECUTION_INDEXES,
  },
  {
    name: "SalesIntelligenceAiBudget",
    model: getSalesIntelligenceAiBudgetModel,
    indexes: SALES_INTELLIGENCE_AI_BUDGET_INDEXES,
  },
  {
    name: "SalesIntelligenceAiReservation",
    model: getSalesIntelligenceAiReservationModel,
    indexes: SALES_INTELLIGENCE_AI_RESERVATION_INDEXES,
  },
  {
    name: "SalesIntelligencePolicyVersion",
    model: getSalesIntelligencePolicyVersionModel,
    indexes: SALES_INTELLIGENCE_POLICY_VERSION_INDEXES,
  },
  {
    name: "SalesIntelligencePolicyPointer",
    model: getSalesIntelligencePolicyPointerModel,
    indexes: SALES_INTELLIGENCE_POLICY_POINTER_INDEXES,
  },
  {
    name: "SalesIntelligenceAttentionSnapshot",
    model: getSalesIntelligenceAttentionSnapshotModel,
    indexes: SALES_INTELLIGENCE_ATTENTION_SNAPSHOT_INDEXES,
  },
  {
    name: "IntelligenceRun",
    model: getIntelligenceRunModel,
    indexes: INTELLIGENCE_RUN_INDEXES,
  },
  {
    name: "IntelligenceEvidenceSnapshot",
    model: getIntelligenceEvidenceSnapshotModel,
    indexes: INTELLIGENCE_EVIDENCE_SNAPSHOT_INDEXES,
  },
  {
    name: "IntelligenceSubmission",
    model: getIntelligenceSubmissionModel,
    indexes: INTELLIGENCE_SUBMISSION_INDEXES,
  },
  {
    name: "IntelligenceFinding",
    model: getIntelligenceFindingModel,
    indexes: INTELLIGENCE_FINDING_INDEXES,
  },
  {
    name: "IntelligenceEffect",
    model: getIntelligenceEffectModel,
    indexes: INTELLIGENCE_EFFECT_INDEXES,
  },
  {
    name: "SalesIntelligenceOwnerInstruction",
    model: getSalesIntelligenceOwnerInstructionModel,
    indexes: SALES_INTELLIGENCE_OWNER_INSTRUCTION_INDEXES,
  },
  {
    name: "IntelligenceOwnerAssessment",
    model: getIntelligenceOwnerAssessmentModel,
    indexes: INTELLIGENCE_OWNER_ASSESSMENT_INDEXES,
  },
  {
    name: "SalesIntelligenceReviewItem",
    model: getSalesIntelligenceReviewItemModel,
    indexes: SALES_INTELLIGENCE_REVIEW_ITEM_INDEXES,
  },
  {
    name: "SalesIntelligenceContactRestriction",
    model: getSalesIntelligenceContactRestrictionModel,
    indexes: SALES_INTELLIGENCE_CONTACT_RESTRICTION_INDEXES,
  },
  {
    name: "CallInteractionAlias",
    model: getCallInteractionAliasModel,
    indexes: CALL_INTERACTION_ALIAS_INDEXES,
  },
  {
    name: "RingCentralDirectorySnapshot",
    model: getRingCentralDirectorySnapshotModel,
    indexes: RING_CENTRAL_DIRECTORY_SNAPSHOT_INDEXES,
  },
  {
    name: "SalesIntelligenceSyncState",
    model: getSalesIntelligenceSyncStateModel,
    indexes: SALES_INTELLIGENCE_SYNC_STATE_INDEXES,
  },
  {
    name: "SalesIntelligenceSyncWindow",
    model: getSalesIntelligenceSyncWindowModel,
    indexes: SALES_INTELLIGENCE_SYNC_WINDOW_INDEXES,
  },
  {
    name: "MoveAssessmentArtifact",
    model: getMoveAssessmentArtifactModel,
    indexes: MOVE_ASSESSMENT_ARTIFACT_INDEXES,
  },
  {
    name: "ContactNumber",
    model: getContactNumberModel,
    indexes: CONTACT_NUMBER_INDEXES,
  },
  {
    name: "CallInteraction",
    model: getCallInteractionModel,
    indexes: CALL_INTERACTION_INDEXES,
  },
  {
    name: "NumberLeadAttachment",
    model: getNumberLeadAttachmentModel,
    indexes: NUMBER_LEAD_ATTACHMENT_INDEXES,
  },
  {
    name: "RepIdentityLink",
    model: getRepIdentityLinkModel,
    indexes: REP_IDENTITY_LINK_INDEXES,
  },
  {
    name: "OwnerRepNudge",
    model: getOwnerRepNudgeModel,
    indexes: OWNER_REP_NUDGE_INDEXES,
  },
  // S9-READS (addendum §6.4): per-rep ET day documents.
  {
    name: "OutreachRepDay",
    model: getOutreachRepDayModel,
    indexes: OUTREACH_REP_DAY_INDEXES,
  },
] as const;
