#!/usr/bin/env bash
set -euo pipefail

stdin_file="$(mktemp)"
changed_file="$(mktemp)"
trap 'rm -f "$stdin_file" "$changed_file"' EXIT
cat > "$stdin_file" || true
export CURSOR_HOOK_STDIN_FILE="$stdin_file"

.cursor/hooks/lib/changed-files.sh > "$changed_file" || true

if [ ! -s "$changed_file" ]; then
  exit 0
fi

structural_pattern='^(src|api)/(modules|services|controllers|routes|jobs|workers|db|lib|config|middleware|models|validation|utils)/|^api/db\.ts$|^package\.json$|^tsconfig.*\.json$|^Dockerfile$|^infra/'
docs_pattern='^\.cursor/rules/codebase\.mdc$|(^|/)README\.md$|^docs/|^internal_hidden_docs/|architecture|adr'

if grep -E "$structural_pattern" "$changed_file" >/dev/null && ! grep -E "$docs_pattern" "$changed_file" >/dev/null; then
  cat >&2 <<'MSG'
Warning: backend structure or runtime behavior changed without a matching codebase docs/rules update.
If this change modifies architecture, folder structure, public interfaces, runtime behavior, or operational assumptions, update the codebase rule/docs. Otherwise state in the final response: 'No codebase documentation update needed.'
MSG
fi
