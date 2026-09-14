# Funded audio intelligence experiment

Performed September 11, 2026 after the user replaced the AI Gateway key. Earlier free-tier errors remain in local artifacts as historical observations. The successful run used only `openai/whisper-1` and `openai/gpt-5.6-luna`. No production records or customer communications were created.

## Results

| Sample | Source and measured media | Observed value |
|---|---|---|
| Recent Form Lead phone match | September 11 outbound Call Log, 125-second record; 95.34 seconds transcribed | The rep left voicemail about an adjusted scooter quote without a price increase. A request for the customer to call back is not a rep promise to call. Provider-connected does not mean human contact. |
| Historical long recording | Existing local outbound sample; 827.58 seconds transcribed, outside the seven-day metrics | Customer discussed nine confirmed employee relocations, possibly ten, and recurring quarterly needs. Leadership approval was pending. The rep had already emailed a quote. This is opportunity evidence, not an official Booking. |

The difference between Call Log duration and decoded media duration is preserved rather than forced to agree. Each audio source retains its provenance in the local artifacts. Neither sample establishes overall model accuracy or account-wide recording access.

## Evidence validation changed the design

The first extraction returned model-written quotes. Seven of 23 quote checks failed exact substring validation, including redaction/ellipsis effects. That is a citation-format failure count, not an accuracy score.

The second extraction uses a constrained schema and returns existing transcript sentence IDs. Code attaches the exact saved sentences. Its 11 findings passed schema and ID-existence checks. One intermediate long-sample attempt failed schema validation; the runner was then switched to SDK structured output and the long sample rerun without retranscription.

Semantic review remains necessary. The long sample's recurring-opportunity finding includes “early December,” but that detail is absent from its four cited sentences. Other compound statements also deserve clause-by-clause review. Valid source IDs cannot certify entailment. The preview displays these as unapproved findings with this limitation visible.

Production extraction should use atomic claims, segment timestamps, speaker confidence, and explicit action actors/status. Preserve distinctions between requested, promised, completed, and conditional actions. Relative dates need call-time and timezone resolution; uncertain dates stay unresolved. An extraction must never directly mark a Booking, penalize a rep, or schedule customer outreach.

## Cost and execution

Whisper transcribed 922.92 seconds in total. At the observed catalog rate of $0.0001/second, that is approximately $0.092292. The two successful first-pass Luna calls consumed 4,398 input and 2,332 output tokens. The two successful second-pass calls consumed 4,822 input and 1,345 output tokens. Including reported cache-write tokens and the observed rates, known successful text usage is approximately $0.00667, for a combined estimate of **$0.099**.

This is not an invoice total: the failed schema-validation attempt has no saved usage, and provider billing was not queried. The first audio-plus-extraction runs took approximately 12.5 seconds and 63.8 seconds; revised text-only extraction took 6.4 and 9.8 seconds. These are two local observations, not production latency guarantees.

Rates were read from the [Gateway model catalog](https://ai-gateway.vercel.sh/v1/models): Luna input $0.20/million tokens, output $1.20/million, cache writes $0.25/million; Whisper $0.006/minute. Production must refresh pricing and reserve a job budget. [Gateway transcription documentation](https://vercel.com/docs/ai-gateway/modalities/speech-to-text) describes the SDK interface used here.

## Data handling and reproducibility

Local ignored artifacts are in `scripts/dev_ops/ringcentral/output/sales-intelligence/`: audio, numbered redacted transcripts, `ai-results.json`, `ai-v2-results.json`, `ai-pricing.json`, and audio provenance. They contain sensitive business context and are not public artifacts. The existing redactor plus phone masking is a baseline, not complete anonymization; spoken digit sequences and names require additional production evaluation. Raw audio remains local for this authorized experiment.

See [prototype findings](prototype-findings.md) for exact rerun commands. The revised extractor skips existing successful sample indices; archive its result file before intentionally rerunning an experiment. The preview generator now expects the successful AI artifact; run it after the AI steps. Follow the [specification](recommendation-specification.md) for the production redaction, retention, authorization, job, and evaluation requirements.
