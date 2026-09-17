import {
  type FollowupDto,
  type AttentionRowDto,
  followupDtoSchema,
  attentionRowDtoSchema,
} from "./dto";
const id = "aaaaaaaaaaaaaaaaaaaaaaaa";
const derived = {
  overdue: false,
  no_owner: true,
  no_next_action: false,
  cooldown: false,
  attention_band: null,
  reasons: ["due_date_needed"],
  review_item_ids: [],
  call_blockers: [],
  age_wall_ms: 0,
  age_staffed_ms: 0,
  policy_version: "csi-policy-v1",
};
export const undatedFollowupFixture: FollowupDto = followupDtoSchema.parse({
  id,
  revision: 1,
  kind: "check_availability",
  description: "Check crew availability",
  status: "open",
  due_at: null,
  base_attention_due_at: null,
  attention_due_at: null,
  snoozed_until: null,
  wait_expired_at: null,
  date_text: null,
  date_resolution: null,
  assignment: {
    agent: null,
    origin: null,
    assigned_at: null,
    evidence_ref: null,
    owner_instruction_id: null,
  },
  promised_by: null,
  origin: "rep_promise",
  provenance_refs: [],
  disposition: null,
  completion_basis: null,
  paused_channels: [],
  overdue: false,
  allowed_actions: [],
});
export const ambiguousReviewFixture: AttentionRowDto =
  attentionRowDtoSchema.parse({
    subject_key: `number_review:${id}`,
    subject: { kind: "number_review", contact_number_id: id },
    outreach: null,
    derived: {
      ...derived,
      reasons: ["ambiguous_identity"],
      call_blockers: ["IDENTITY_BLOCKED"],
    },
    allowed_actions: [],
  });
export const closedReviewFixture: AttentionRowDto = attentionRowDtoSchema.parse(
  {
    ...ambiguousReviewFixture,
    derived: {
      ...derived,
      reasons: ["new_request_on_closed_work"],
      call_blockers: ["OFFICIAL_STATE_BLOCKS_REOPEN"],
    },
  },
);
export const unknownCoverageFixture = {
  known_through: null,
  gaps: [],
  capabilities: { recording: "unknown" as const },
  ai_paused: true,
};
