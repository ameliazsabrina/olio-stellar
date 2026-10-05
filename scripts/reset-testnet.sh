#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
exec pnpm --filter web storage:reset -- --env-file=.env.local "$@"
