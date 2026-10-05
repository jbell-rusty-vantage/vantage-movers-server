import { getSalesOutreachConfigurationModel, SALES_OUTREACH_CONFIGURATION_INDEXES } from "./configuration";
import { getSalesOutreachContactEventModel, SALES_OUTREACH_CONTACT_EVENT_INDEXES } from "./contactEvents";
import { getSalesOutreachEnrollmentRunModel, SALES_OUTREACH_ENROLLMENT_RUN_INDEXES } from "./enrollmentRuns";
import { getSalesOutreachFollowupScheduleModel, SALES_OUTREACH_FOLLOWUP_SCHEDULE_INDEXES } from "./followupSchedules";
import { getSalesOutreachLiveEventModel, SALES_OUTREACH_LIVE_EVENT_INDEXES } from "./liveEvents";
import { getSalesOutreachPolicyPeriodModel, SALES_OUTREACH_POLICY_PERIOD_INDEXES } from "./policyPeriods";
import {
  getSalesOutreachProjectionModel,
  getSalesOutreachRepDayProjectionModel,
  SALES_OUTREACH_PROJECTION_INDEXES,
  SALES_OUTREACH_REP_DAY_PROJECTION_INDEXES,
} from "./projections";
import { getSalesOutreachSubjectModel, SALES_OUTREACH_SUBJECT_INDEXES } from "./subjects";
import { getRingCentralRepSmsEvidenceModel, RINGCENTRAL_REP_SMS_EVIDENCE_INDEXES } from "./repSmsEvidence";

/**
 * Every collection the Sales Outreach Desk owns, with its declared indexes. The index build script
 * (`ops/sales-outreach/build-indexes.ts`) reads only this list; nothing builds indexes at startup
 * or in a GET (`autoIndex`/`autoCreate` are off through `defineCsiModel`).
 *
 * Lane S3 appends `ringcentral_rep_sms_evidence` here in a `shared(registry):` commit.
 */
export const SALES_OUTREACH_MODEL_REGISTRY = [
  { name: "SalesOutreachConfiguration", model: getSalesOutreachConfigurationModel, indexes: SALES_OUTREACH_CONFIGURATION_INDEXES },
  { name: "SalesOutreachSubject", model: getSalesOutreachSubjectModel, indexes: SALES_OUTREACH_SUBJECT_INDEXES },
  { name: "SalesOutreachPolicyPeriod", model: getSalesOutreachPolicyPeriodModel, indexes: SALES_OUTREACH_POLICY_PERIOD_INDEXES },
  { name: "SalesOutreachFollowupSchedule", model: getSalesOutreachFollowupScheduleModel, indexes: SALES_OUTREACH_FOLLOWUP_SCHEDULE_INDEXES },
  { name: "SalesOutreachContactEvent", model: getSalesOutreachContactEventModel, indexes: SALES_OUTREACH_CONTACT_EVENT_INDEXES },
  { name: "SalesOutreachProjection", model: getSalesOutreachProjectionModel, indexes: SALES_OUTREACH_PROJECTION_INDEXES },
  { name: "SalesOutreachRepDayProjection", model: getSalesOutreachRepDayProjectionModel, indexes: SALES_OUTREACH_REP_DAY_PROJECTION_INDEXES },
  { name: "SalesOutreachEnrollmentRun", model: getSalesOutreachEnrollmentRunModel, indexes: SALES_OUTREACH_ENROLLMENT_RUN_INDEXES },
  // S1 (SRV-8): committed live invalidation hints for GET /live (TTL one day).
  { name: "SalesOutreachLiveEvent", model: getSalesOutreachLiveEventModel, indexes: SALES_OUTREACH_LIVE_EVENT_INDEXES },
  // S3 (SRV-5): rep SMS capture evidence (RINGCENTRAL-CAPTURE §5, IMPLEMENTATION-PLAN §4.7).
  { name: "RingCentralRepSmsEvidence", model: getRingCentralRepSmsEvidenceModel, indexes: RINGCENTRAL_REP_SMS_EVIDENCE_INDEXES },
] as const;
