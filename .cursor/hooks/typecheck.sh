#!/usr/bin/env bash
set -euo pipefail

stdin_file="$(mktemp)"
output_file="$(mktemp)"
trap 'rm -f "$stdin_file" "$output_file"' EXIT
cat > "$stdin_file" || true
export CURSOR_HOOK_STDIN_FILE="$stdin_file"

source ".cursor/hooks/lib/package-manager.sh"

script=""
for candidate in typecheck type-check check:types; do
  if has_package_script "$candidate"; then
    script="$candidate"
    break
  fi
done

echo "Running TypeScript validation..."

if [ -n "$script" ]; then
  if ! run_package_script "$script" >"$output_file" 2>&1; then
    sed -n '1,80p' "$output_file" >&2
    cat >&2 <<'MSG'

Typecheck failed. Fix the type errors before completing the task.
Do not bypass this with `any`, unsafe double-casts, `as unknown as`, `// @ts-ignore`, or weakened types unless a nearby comment explains the unavoidable reason.
MSG
    exit 2
  fi
else
  if ! package_exec tsc --noEmit >"$output_file" 2>&1; then
    sed -n '1,80p' "$output_file" >&2
    cat >&2 <<'MSG'

`tsc --noEmit` failed. Fix the type errors before completing the task.
Do not bypass this with `any`, unsafe double-casts, `as unknown as`, `// @ts-ignore`, or weakened types unless a nearby comment explains the unavoidable reason.
MSG
    exit 2
  fi
fi

echo "Typecheck passed."
