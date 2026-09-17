/**
 * Synthetic CSI envelope fixtures for schema-validation tests and later teams.
 * No credentials, provider bodies, or raw customer transcripts.
 *
 * Every exported object is intended to be schema-valid. Invalid cases live in
 * the validator tests so failures stay next to the assertion.
 */

const TRANSCRIPT_EVIDENCE = {
  source: "transcript" as const,
  snapshot_id: "snap_transcript_001",
  conversation_id: "conv_synthetic_001",
  transcript_version: "transcript_v1",
  segment_ids: [4, 5],
  quote: "I will call you Friday after 2.",
};

function envelope(partial: {
  overview: string;
  customer_wanted: string;
  money_and_dates: string;
  outcome: string;
  commitments: string;
  discrepancies: string;
  finding_keys: string[];
  findings: unknown[];
  next_step_suggestion?: unknown;
  owner_instruction_assessments?: unknown[];
}) {
  return {
    schema_version: "csi-envelope-v1" as const,
    summary: {
      overview: partial.overview,
      customer_wanted: partial.customer_wanted,
      money_and_dates: partial.money_and_dates,
      outcome: partial.outcome,
      commitments: partial.commitments,
      discrepancies: partial.discrepancies,
      finding_keys: partial.finding_keys,
    },
    findings: partial.findings,
    next_step_suggestion: partial.next_step_suggestion ?? null,
    owner_instruction_assessments: partial.owner_instruction_assessments ?? [],
  };
}

function findingBase(input: {
  key: string;
  claim: string;
  actor: "rep" | "customer" | "unknown";
  action_status: "requested" | "promised" | "completed" | "conditional" | null;
  speaker_ref?: string | null;
  evidence?: unknown[];
}) {
  return {
    key: input.key,
    claim: input.claim,
    basis: "said_on_call" as const,
    actor: input.actor,
    speaker_ref: input.speaker_ref === undefined ? "participant_rep_1" : input.speaker_ref,
    action_status: input.action_status,
    clarity: "clear" as const,
    evidence: input.evidence ?? [TRANSCRIPT_EVIDENCE],
    confidence: 0.71,
  };
}

/** Distinct kinds: a rep promise is never labeled a customer callback request. */
export const repPromiseVsCustomerCallbackFixture = envelope({
  overview:
    "Customer asked for a callback and the mapped rep separately promised Friday.",
  customer_wanted: "A return call about the Brooklyn to Miami estimate.",
  money_and_dates: "No amount stated. Customer asked for Friday; rep promised Friday after 2.",
  outcome: "Conversation ended with two distinct callback commitments.",
  commitments:
    "Rep promised to call Friday after 2. Customer requested a callback Friday morning.",
  discrepancies: "None observed in this synthetic envelope.",
  finding_keys: ["rep_promised_friday", "customer_requested_friday"],
  findings: [
    {
      ...findingBase({
        key: "rep_promised_friday",
        claim: "Rep promised to call the customer Friday after 2.",
        actor: "rep",
        action_status: "promised",
        evidence: [
          {
            ...TRANSCRIPT_EVIDENCE,
            segment_ids: [12],
            quote: "I will call you Friday after 2.",
          },
        ],
      }),
      kind: "promised_callback",
      value: {
        action_kind: "call",
        description: "Rep-promised callback Friday after 2.",
        date_text: "Friday after 2",
        timezone_text: "America/New_York",
        target_followup_id: null,
      },
    },
    {
      ...findingBase({
        key: "customer_requested_friday",
        claim: "Customer asked the company to call Friday morning.",
        actor: "customer",
        action_status: "requested",
        speaker_ref: "participant_customer_1",
        evidence: [
          {
            ...TRANSCRIPT_EVIDENCE,
            segment_ids: [7],
            quote: "Can you call me Friday morning?",
          },
        ],
      }),
      kind: "customer_requested_callback",
      value: {
        action_kind: "call",
        description: "Customer-requested callback Friday morning.",
        date_text: "Friday morning",
        timezone_text: "America/New_York",
        target_followup_id: null,
      },
    },
  ],
});

/** Multiple independent actions, including one undated availability check. */
export const multipleCommitmentsUndatedActionFixture = envelope({
  overview: "Three next actions: dated callback, dated estimate, undated availability check.",
  customer_wanted: "A callback, a written estimate, and a warehouse-availability check.",
  money_and_dates: "Estimate requested today. Callback Friday. Availability has no date.",
  outcome: "Commitments recorded; availability still needs a date.",
  commitments:
    "Call Friday, send estimate today, and check availability with no stated date.",
  discrepancies: "Availability check is clear as an action and undated.",
  finding_keys: [
    "callback_friday",
    "send_estimate_today",
    "undated_availability",
  ],
  findings: [
    {
      ...findingBase({
        key: "callback_friday",
        claim: "Rep promised to call Friday.",
        actor: "rep",
        action_status: "promised",
      }),
      kind: "promised_callback",
      value: {
        action_kind: "call",
        description: "Call the customer Friday.",
        date_text: "Friday",
        timezone_text: "Eastern",
        target_followup_id: null,
      },
    },
    {
      ...findingBase({
        key: "send_estimate_today",
        claim: "Rep promised to send the estimate today.",
        actor: "rep",
        action_status: "promised",
        evidence: [
          {
            ...TRANSCRIPT_EVIDENCE,
            segment_ids: [18],
            quote: "I will send the estimate today.",
          },
        ],
      }),
      kind: "next_step",
      value: {
        action_kind: "send_estimate",
        description: "Send the written estimate today.",
        date_text: "today",
        timezone_text: "America/New_York",
        target_followup_id: null,
      },
    },
    {
      ...findingBase({
        key: "undated_availability",
        claim: "Rep said they would check warehouse availability.",
        actor: "rep",
        action_status: "promised",
        evidence: [
          {
            ...TRANSCRIPT_EVIDENCE,
            segment_ids: [21],
            quote: "Let me check availability and get back to you.",
          },
        ],
      }),
      kind: "next_step",
      value: {
        action_kind: "check_availability",
        description: "Check warehouse availability.",
        date_text: null,
        timezone_text: null,
        target_followup_id: null,
      },
    },
  ],
  next_step_suggestion: {
    action_kind: "review",
    description: "Ask Owner to date the availability check.",
    date_text: null,
    timezone_text: null,
    target_followup_id: null,
    rationale: "Suggestion only. Schema validity does not apply this as work.",
    finding_keys: ["undated_availability"],
  },
});

/** Voicemail with unknown speaker. Provider-connected is not human conversation. */
export const voicemailUnknownSpeakerFixture = envelope({
  overview: "A voicemail was left. Speaker identity is unknown.",
  customer_wanted: "Unknown from this recording.",
  money_and_dates: "None stated.",
  outcome: "Voicemail—speaker unknown. No human-conversation stamp.",
  commitments: "None.",
  discrepancies: "Provider connected; contact type remains voicemail with unknown speaker.",
  finding_keys: ["voicemail_unknown_speaker"],
  findings: [
    {
      ...findingBase({
        key: "voicemail_unknown_speaker",
        claim: "A voicemail was left; the speaker could not be identified.",
        actor: "unknown",
        action_status: null,
        speaker_ref: null,
        evidence: [
          {
            ...TRANSCRIPT_EVIDENCE,
            segment_ids: [0],
            quote: "Please call us back when you can.",
          },
        ],
      }),
      kind: "contact_type",
      value: {
        type: "voicemail",
        voicemail_left_by: "unknown",
      },
    },
  ],
});

/** Spoken call restriction. Does not close Outreach or suppress texting. */
export const contactRestrictionFixture = envelope({
  overview: "Customer asked not to be called before Friday.",
  customer_wanted: "No calls until Friday.",
  money_and_dates: "Restriction until Friday. No amount stated.",
  outcome: "Temporary call restriction stated.",
  commitments: "None besides the restriction.",
  discrepancies: "Call channel paused pending later effect checks; text is unmentioned.",
  finding_keys: ["no_calls_until_friday"],
  findings: [
    {
      ...findingBase({
        key: "no_calls_until_friday",
        claim: "Customer said do not call before Friday.",
        actor: "customer",
        action_status: "requested",
        speaker_ref: "participant_customer_1",
        evidence: [
          {
            ...TRANSCRIPT_EVIDENCE,
            segment_ids: [3],
            quote: "Don't call me before Friday.",
          },
        ],
      }),
      kind: "contact_restriction",
      value: {
        channels: ["call"],
        restriction: "until",
        until_text: "Friday",
      },
    },
  ],
});

/** Model disagrees with a versioned Owner instruction. */
export const ownerInstructionDisagreementFixture = envelope({
  overview: "Model extracted a Friday promise that disagrees with the Owner wait.",
  customer_wanted: "Customer asked the company to wait.",
  money_and_dates: "Rep promised Friday. Owner instruction says wait.",
  outcome: "Disagreement recorded against instruction revision 3.",
  commitments: "Rep promised Friday; Owner already instructed wait.",
  discrepancies: "Model disagrees with the current Owner instruction version.",
  finding_keys: ["rep_promised_friday"],
  findings: [
    {
      ...findingBase({
        key: "rep_promised_friday",
        claim: "Rep promised to call Friday.",
        actor: "rep",
        action_status: "promised",
        evidence: [
          TRANSCRIPT_EVIDENCE,
          {
            source: "vantage_record" as const,
            snapshot_id: "snap_owner_instruction_003",
            record_type: "owner_instruction" as const,
            record_id: "instr_wait_001",
            field_paths: ["instruction_text", "revision"],
          },
        ],
      }),
      kind: "promised_callback",
      value: {
        action_kind: "call",
        description: "Rep-promised Friday callback.",
        date_text: "Friday",
        timezone_text: "America/New_York",
        target_followup_id: null,
      },
    },
  ],
  owner_instruction_assessments: [
    {
      instruction_id: "instr_wait_001",
      instruction_revision: 3,
      assessment: "disagrees",
      reason: "Envelope records a Friday call promise against the Owner wait instruction.",
      finding_keys: ["rep_promised_friday"],
    },
  ],
});

export const intelligenceEnvelopeFixtures = {
  repPromiseVsCustomerCallback: repPromiseVsCustomerCallbackFixture,
  multipleCommitmentsUndatedAction: multipleCommitmentsUndatedActionFixture,
  voicemailUnknownSpeaker: voicemailUnknownSpeakerFixture,
  contactRestriction: contactRestrictionFixture,
  ownerInstructionDisagreement: ownerInstructionDisagreementFixture,
} as const;
