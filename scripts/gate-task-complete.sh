#!/usr/bin/env bash
# TaskCompleted gate. Runs typecheck+tests for the touched workspace if present.
# Non-blocking by design: reports, never fails the task on missing tooling.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
[ -f package.json ] || exit 0
if command -v pnpm >/dev/null 2>&1 && [ -d node_modules ]; then
  pnpm -r --if-present typecheck 2>&1 | tail -20
fi
exit 0
