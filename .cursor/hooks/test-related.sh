#!/usr/bin/env bash
set -euo pipefail

stdin_file="$(mktemp)"
output_file="$(mktemp)"
changed_file="$(mktemp)"
test_file="$(mktemp)"
trap 'rm -f "$stdin_file" "$output_file" "$changed_file" "$test_file"' EXIT
cat > "$stdin_file" || true
export CURSOR_HOOK_STDIN_FILE="$stdin_file"

source ".cursor/hooks/lib/package-manager.sh"

.cursor/hooks/lib/changed-files.sh > "$changed_file" || true

if [ ! -s "$changed_file" ]; then
  echo "No changed files detected; skipping targeted tests."
  exit 0
fi

grep -E '\.(ts|tsx|js|jsx)$' "$changed_file" | grep -E '^(api|scripts|types)/|package\.json$|tsconfig.*\.json$' > "$test_file" || true

if [ ! -s "$test_file" ]; then
  echo "No relevant source or test files changed; skipping targeted tests."
  exit 0
fi

test_framework="node"
if [ -f "jest.config.js" ] || [ -f "jest.config.ts" ] || node -e 'const p=require("./package.json");process.exit((p.dependencies?.jest||p.devDependencies?.jest) ? 0 : 1)' 2>/dev/null; then
  test_framework="jest"
elif [ -f "vitest.config.js" ] || [ -f "vitest.config.ts" ] || node -e 'const p=require("./package.json");process.exit((p.dependencies?.vitest||p.devDependencies?.vitest) ? 0 : 1)' 2>/dev/null; then
  test_framework="vitest"
fi

is_test_file() {
  case "$1" in
    *.test.ts|*.test.tsx|*.test.js|*.test.jsx|*.spec.ts|*.spec.tsx|*.spec.js|*.spec.jsx) return 0 ;;
    *) return 1 ;;
  esac
}

business_relevant=false
while IFS= read -r path; do
  case "$path" in
    api/routes/*|api/services/*|api/controllers/*|api/models/*|api/db.ts|api/config/*|api/validation/*|api/middleware/*|scripts/historical/*|scripts/dev_ops/*|*.test.ts|*.spec.ts|package.json|tsconfig*.json)
      business_relevant=true
      ;;
  esac
done < "$test_file"

direct_tests=()
while IFS= read -r path; do
  if is_test_file "$path" && [ -f "$path" ]; then
    direct_tests+=("$path")
    continue
  fi

  base="${path%.*}"
  for candidate in "$base.test.ts" "$base.spec.ts" "$base.test.js" "$base.spec.js"; do
    if [ -f "$candidate" ]; then
      direct_tests+=("$candidate")
    fi
  done
done < "$test_file"

if [ "$test_framework" = "jest" ]; then
  mapfile -t changed_paths < "$test_file"
  if [ "${#changed_paths[@]}" -gt 0 ] && has_package_script test; then
    echo "Running Jest related tests..."
    if ! run_package_script test --findRelatedTests "${changed_paths[@]}" >"$output_file" 2>&1; then
      sed -n '1,120p' "$output_file" >&2
      echo "Related Jest tests failed." >&2
      exit 2
    fi
    echo "Related Jest tests passed."
    exit 0
  fi
fi

if [ "$test_framework" = "vitest" ] && [ "${#direct_tests[@]}" -gt 0 ] && has_package_script test; then
  echo "Running direct Vitest tests..."
  if ! run_package_script test "${direct_tests[@]}" >"$output_file" 2>&1; then
    sed -n '1,120p' "$output_file" >&2
    echo "Direct Vitest tests failed." >&2
    exit 2
  fi
  echo "Direct Vitest tests passed."
  exit 0
fi

if [ "$test_framework" = "node" ] && [ "${#direct_tests[@]}" -gt 0 ]; then
  echo "Running direct Node test files..."
  if ! node --import tsx --import ./scripts/test-setup.ts --test "${direct_tests[@]}" >"$output_file" 2>&1; then
    sed -n '1,120p' "$output_file" >&2
    echo "Direct Node tests failed." >&2
    exit 2
  fi
  echo "Direct Node tests passed."
  exit 0
fi

if [ "$business_relevant" = true ] && has_package_script test; then
  echo "No direct related tests found; running repository test script for relevant backend changes..."
  if ! run_package_script test >"$output_file" 2>&1; then
    sed -n '1,120p' "$output_file" >&2
    echo "Repository tests failed." >&2
    exit 2
  fi
  echo "Repository tests passed."
  exit 0
fi

echo "Warning: no targeted test path was detected for changed files. Explain tests not run in the final response."
