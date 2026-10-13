#!/bin/sh
# xez-prepare-test-env: generated entrypoint (contract v2)
# regenerate with: xez-prepare-test-env --regenerate
# history:
#   2026-07-14 generated — mirrors test-env-up.sh; no services to remove, so this
#             only stops the app PID this repo started and marks the descriptor stopped.
#   2026-10-10 Git Bash on Windows: the recorded pid is node's Windows pid, stopped with taskkill
#             (that exact pid and its tree); POSIX behaviour is unchanged.
#   2026-10-11 Windows: the pid counts only while it still names the process that started at
#             app.processStartedAt, and the stop goes through scripts/test-env-windows.mjs (that
#             exact process and its creation-filtered tree), never taskkill /T.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
QA_DIR="$REPO_ROOT/.local/qa"
# Compatibility: an old-path process must still be stoppable before migration.
if [ ! -f "$QA_DIR/test-env.json" ] && [ -f "$REPO_ROOT/.ai/qa/test-env.json" ]; then
  QA_DIR="$REPO_ROOT/.ai/qa"
fi
ENV_DESCRIPTOR="$QA_DIR/test-env.json"

log() { echo "[test-env] $*" >&2; }

[ -f "$ENV_DESCRIPTOR" ] || { log "no descriptor — nothing to stop"; exit 0; }

pid=$(node -e '
  const fs = require("fs");
  try {
    const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (d.startedByThisRepo && d.app && d.app.pid) process.stdout.write(String(d.app.pid));
  } catch { /* corrupt descriptor → nothing safe to stop */ }
' "$ENV_DESCRIPTOR" 2>/dev/null || true)
pid_started=$(node -e '
  const fs = require("fs");
  try {
    const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (d.app && d.app.processStartedAt) process.stdout.write(String(d.app.processStartedAt));
  } catch { /* no start time → the Windows pid is never trusted */ }
' "$ENV_DESCRIPTOR" 2>/dev/null || true)

# Git Bash (MSYS) on Windows: the descriptor holds node's WINDOWS pid, which the shell's own
# `kill` does not know, and a native program gets no catchable stop signal. Windows reuses pids
# within seconds, so the pid counts only together with the start time the descriptor records.
case "$(uname -s 2>/dev/null || true)" in
  MINGW*|MSYS*) ON_WINDOWS=1 ;;
  *) ON_WINDOWS=0 ;;
esac
HELPER="$SCRIPT_DIR/test-env-windows.mjs"

# Only ever stop what this repo started; safe to run twice.
if [ "$ON_WINDOWS" = 1 ]; then
  # Exactly that process and the processes it started, each killed by its start time — never by
  # image name or pattern, and never taskkill /T. One call checks and stops (each costs a
  # PowerShell start), and it answers `gone` when the pid no longer names that process.
  state=""
  [ -z "$pid" ] || state=$(node "$HELPER" stop "$pid" "$pid_started" || echo failed)
  case "$state" in
    stopped) log "stopped xezar (pid $pid)" ;;
    failed|running) log "could not stop pid $pid" ;;
    *) log "app is already stopped" ;;
  esac
elif [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
  log "stopping xezar (pid $pid)"
  kill "$pid" 2>/dev/null || true
  waited=0
  while kill -0 "$pid" 2>/dev/null && [ "$waited" -lt 10 ]; do
    sleep 1
    waited=$((waited + 1))
  done
  kill -9 "$pid" 2>/dev/null || true
else
  log "app is already stopped"
fi

node -e '
  const fs = require("fs");
  const f = process.argv[1];
  try {
    const d = JSON.parse(fs.readFileSync(f, "utf8"));
    d.status = "stopped";
    fs.writeFileSync(f, JSON.stringify(d, null, 2) + "\n");
  } catch { /* leave a corrupt descriptor alone — up will treat it as stale */ }
' "$ENV_DESCRIPTOR"

rm -rf "$QA_DIR/test-env.lock" 2>/dev/null || true
echo "TEST_ENV_STATUS=stopped"
