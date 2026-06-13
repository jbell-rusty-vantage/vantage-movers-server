#!/usr/bin/env bash
set -euo pipefail

stdin_file="$(mktemp)"
output_file="$(mktemp)"
trap 'rm -f "$stdin_file" "$output_file"' EXIT
cat > "$stdin_file" || true
export CURSOR_HOOK_STDIN_FILE="$stdin_file"

source ".cursor/hooks/lib/package-manager.sh"

script=""
for candidate in lint format:check check:format; do
  if has_package_script "$candidate"; then
    script="$candidate"
    break
  fi
done

if [ -z "$script" ]; then
  echo "No lint or format-check script configured; skipping lint hook."
  exit 0
fi

echo "Running $script..."
if run_package_script "$script" >"$output_file" 2>&1; then
  echo "$script passed."
  exit 0
fi

changed="$(".cursor/hooks/lib/changed-files.sh" | tr '\n' '|' | sed 's/|$//')"
if [ -n "$changed" ] && grep -E "$changed" "$output_file" >/dev/null 2>&1; then
  sed -n '1,100p' "$output_file" >&2
  echo "$script failed on changed files." >&2
  exit 2
fi

sed -n '1,60p' "$output_file" >&2
echo "$script failed, but this hook is fail-open because the errors were not clearly attributable to changed files." >&2
exit 0
