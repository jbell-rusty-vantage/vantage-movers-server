#!/usr/bin/env bash
set -euo pipefail

detect_package_manager() {
  if [ -f "pnpm-lock.yaml" ]; then
    printf '%s\n' "pnpm"
  elif [ -f "yarn.lock" ]; then
    printf '%s\n' "yarn"
  elif [ -f "bun.lockb" ] || [ -f "bun.lock" ]; then
    printf '%s\n' "bun"
  elif [ -f "package-lock.json" ]; then
    printf '%s\n' "npm"
  else
    printf '%s\n' "Unable to determine package manager: no known lockfile found." >&2
    return 1
  fi
}

has_package_script() {
  local script_name="${1:?script name required}"

  node -e '
    const fs = require("fs");
    const script = process.argv[1];
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    process.exit(pkg.scripts && Object.prototype.hasOwnProperty.call(pkg.scripts, script) ? 0 : 1);
  ' "$script_name"
}

run_package_script() {
  local script_name="${1:?script name required}"
  shift || true

  local extra_args=("$@")

  case "$(detect_package_manager)" in
    pnpm)
      if [ "${#extra_args[@]}" -gt 0 ]; then
        pnpm run "$script_name" -- "${extra_args[@]}"
      else
        pnpm run "$script_name"
      fi
      ;;
    yarn) yarn run "$script_name" "$@" ;;
    bun) bun run "$script_name" "$@" ;;
    npm)
      if [ "${#extra_args[@]}" -gt 0 ]; then
        npm run "$script_name" -- "${extra_args[@]}"
      else
        npm run "$script_name"
      fi
      ;;
  esac
}

package_exec() {
  local binary="${1:?binary required}"
  shift || true

  if [ -x "./node_modules/.bin/$binary" ]; then
    "./node_modules/.bin/$binary" "$@"
    return
  fi

  case "$(detect_package_manager)" in
    pnpm) pnpm exec "$binary" "$@" ;;
    yarn) yarn exec "$binary" "$@" ;;
    bun) bunx --bun "$binary" "$@" ;;
    npm) npm exec --no -- "$binary" "$@" ;;
  esac
}
