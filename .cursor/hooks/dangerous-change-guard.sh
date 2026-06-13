#!/usr/bin/env bash
set -euo pipefail

stdin_file="$(mktemp)"
changed_file="$(mktemp)"
trap 'rm -f "$stdin_file" "$changed_file"' EXIT
cat > "$stdin_file" || true
export CURSOR_HOOK_STDIN_FILE="$stdin_file"

command_text="$(node -e '
const fs = require("fs");
try {
  const data = JSON.parse(fs.readFileSync(0, "utf8"));
  const values = [];
  const walk = (value) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.forEach(walk);
    for (const [key, child] of Object.entries(value)) {
      if (/command|cmd|shell/i.test(key) && typeof child === "string") values.push(child);
      walk(child);
    }
  };
  walk(data);
  console.log(values.join("\n"));
} catch {}
' < "$stdin_file" 2>/dev/null || true)"

if [ -n "$command_text" ]; then
  if printf '%s\n' "$command_text" | grep -Eiq '(^|[ ;|&])(rm|drop|truncate|delete|clear|wipe|destroy|migrate reset|db:clear|db:clear:booked|webhook:delete:all)([ :;|&]|$)' &&
     printf '%s\n' "$command_text" | grep -Eiq 'prod|production|MONGODB_URI|DATABASE_URL|--env-file=\.env|node --env-file=\.env'; then
    cat >&2 <<'MSG'
Blocked: this shell command looks like a destructive database or webhook operation against a production-like environment.
Use a clearly non-production target, add an explicit dry run, or ask the user to approve the production operation.
MSG
    exit 2
  fi
fi

.cursor/hooks/lib/changed-files.sh > "$changed_file" || true

if [ ! -s "$changed_file" ]; then
  exit 0
fi

if grep -E '(^|/)\.env(\.|$)|(^|/)\.env$' "$changed_file" | grep -Ev '(^|/)\.env\.example$|(^|/)\.env\.sample$|(^|/)\.env\.template$' >/dev/null; then
  cat >&2 <<'MSG'
Blocked: actual secret env files must not be read or modified by agents.
Use `.env.example` or documentation files for configuration shape changes.
MSG
  exit 2
fi

if grep -E '(^|/)(migrations|prisma|drizzle|schema|infra)/|(^|/)src/db/|(^|/)api/db\.ts$|(^|/)(api|src)/.*/(auth|payment|billing|invoice|webhook|config)/|(^|/)(Dockerfile|docker-compose.*|package\.json|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|bun\.lockb?|tsconfig.*\.json)$|(^|/)api/(config|middleware|routes)/' "$changed_file" >/dev/null; then
  cat >&2 <<'MSG'
Warning: high-risk backend files changed.
Final response must include: what changed, migration/backward-compatibility implications, rollback considerations, required env/config changes, and tests run.
MSG
fi
