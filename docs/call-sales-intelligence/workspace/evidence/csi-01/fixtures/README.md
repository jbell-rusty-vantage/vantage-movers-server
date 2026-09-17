# CSI-01 synthetic envelope fixtures

Canonical TypeScript sources: `src/validation/intelligence/fixtures.ts`.

These JSON copies are schema-valid `csi-envelope-v1` examples for review. They are not authorized evidence and they do not apply effects.

| File | Scenario |
| --- | --- |
| `rep-promise-vs-customer-callback.json` | Distinct `promised_callback` vs `customer_requested_callback` |
| `multiple-commitments-undated-action.json` | Friday call, estimate today, undated availability |
| `voicemail-unknown-speaker.json` | Voicemail, unknown speaker, not human conversation |
| `contact-restriction.json` | Temporary call restriction |
| `owner-instruction-disagreement.json` | Assessment `disagrees` on instruction revision 3 |

Rejected extra-field and malformed-evidence cases are constructed in `src/validation/intelligence/intelligenceEnvelope.validation.test.ts`.
