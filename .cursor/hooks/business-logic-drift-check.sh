#!/usr/bin/env bash
set -euo pipefail

BLOCK_ON_DRIFT="${BLOCK_ON_BUSINESS_LOGIC_DRIFT:-false}"

stdin_file="$(mktemp)"
changed_file="$(mktemp)"
trap 'rm -f "$stdin_file" "$changed_file"' EXIT
cat > "$stdin_file" || true
export CURSOR_HOOK_STDIN_FILE="$stdin_file"

.cursor/hooks/lib/changed-files.sh > "$changed_file" || true

if [ ! -s "$changed_file" ]; then
  exit 0
fi

domain_pattern='quote|estimate|move|booking|booked|crew|availability|schedule|dispatch|pricing|customer|lead|crm|invoice|payment|referral|mover|truck|route|job|granot|ringcentral|sheetSync|sheet-sync|cancellation|cancelled'
business_doc_pattern='^\.cursor/rules/business-logic\.mdc$|^\.cursor/rules/(owner-lead-workflow|form-lead-granot-crm|granot-crm-csv-s3-sync|ringcentral-call-lead-candidates|ringcentral-integration|sheet-sync-process|schema-and-crud-inputs)\.mdc$|^docs/|^internal_hidden_docs/'

if grep -Ei "$domain_pattern" "$changed_file" | grep -E '^(api|src|scripts)/.*\.(ts|tsx|js|jsx)$' >/dev/null &&
   ! grep -E "$business_doc_pattern" "$changed_file" >/dev/null; then
  cat >&2 <<'MSG'
Warning: Vantage Movers domain logic changed without a matching business docs/rules update.
If this change modifies Vantage Movers domain behavior, update `.cursor/rules/business-logic.mdc` or the relevant business doc with concept, source of truth, invariants, edge cases, and examples. Otherwise state in the final response: 'No business logic documentation update needed.'
MSG
  if [ "$BLOCK_ON_DRIFT" = "true" ]; then
    exit 2
  fi
fi
