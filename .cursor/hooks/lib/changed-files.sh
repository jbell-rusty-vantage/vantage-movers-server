#!/usr/bin/env bash
set -euo pipefail

stdin_file="${CURSOR_HOOK_STDIN_FILE:-}"

collect_from_json() {
  local json_file="${1:?json file required}"

  [ -s "$json_file" ] || return 1
  command -v node >/dev/null 2>&1 || return 1

  node -e '
const fs = require("fs");
let data;

try {
  data = JSON.parse(fs.readFileSync(0, "utf8"));
} catch {
  process.exit(1);
}

const found = new Set();
const deleted = new Set();

function addPath(value) {
  if (typeof value !== "string" || !value.trim()) return;
  const normalized = value.replace(/\\/g, "/");
  if (!normalized.includes("\0")) found.add(normalized);
}

function walk(value) {
  if (!value || typeof value !== "object") return;

  if (Array.isArray(value)) {
    for (const item of value) walk(item);
    return;
  }

  const status = String(value.status || value.changeType || value.type || "").toLowerCase();
  const candidateKeys = [
    "path",
    "file",
    "filePath",
    "filepath",
    "uri",
    "relativePath",
    "target_file",
    "targetFile",
    "targetNotebook",
  ];

  for (const key of candidateKeys) {
    if (typeof value[key] === "string") {
      const normalized = value[key].replace(/^file:\/\//, "").replace(/\\/g, "/");
      if (status === "deleted" || status === "delete" || status === "removed") {
        deleted.add(normalized);
      } else {
        addPath(normalized);
      }
    }
  }

  for (const child of Object.values(value)) walk(child);
}

walk(data);

for (const path of found) {
  if (!deleted.has(path)) console.log(path);
}
  ' < "$json_file"
}

collect_from_git() {
  if ! command -v git >/dev/null 2>&1 || ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    return 0
  fi

  if git rev-parse --verify HEAD >/dev/null 2>&1; then
    git diff --name-only --diff-filter=ACMR HEAD || true
  fi

  git diff --cached --name-only --diff-filter=ACMR || true
}

main() {
  if [ -n "$stdin_file" ] && [ -f "$stdin_file" ]; then
    collect_from_json "$stdin_file" || true
  fi

  collect_from_git
}

main | sed 's#^\./##' | awk 'NF && !seen[$0]++'
