## 🔧 Changed

- 🔧 **Windows is supported natively.** The install notes no longer say "in progress" or send
  Windows users to WSL. They list what Windows needs: the full Git for Windows (its Git Bash runs
  workflow check steps) and long paths turned on; the MCP limits on Windows are listed under
  Changed. (#963)

## 🐛 Fixes

- 🐛 **The first health answer after start-up is immediate.** It reuses the agent and repository
  check xezar just made while starting, instead of starting every agent CLI a second time; the
  first cockpit load and the first leader call no longer wait seconds for it. (#963)
- 🐛 **Windows: xezar no longer freezes for about two seconds after start-up.** The first
  PowerShell a process starts holds its thread for one to two seconds while Windows creates it; xezar
  now starts PowerShell from a worker thread, so requests, the MCP leader and the cockpit keep being
  answered. (#963)
- 🐛 **Windows: a killed xezar no longer blocks the next start with "project data is already in
  use".** Windows reuses process IDs quickly, so the left-behind claim's ID could name an unrelated
  program. A claim now also records when its process started, and an ID that now names a later
  process no longer counts as the writer. Linux and macOS are unchanged. (#963)
- 🐛 **Windows: a busy machine no longer pauses xezar while it checks the project lock.** The check
  that tells a left-behind claim from a live one now runs in the background once xezar is serving,
  and the project list and the lock give the same answer. (#963)
- 🐛 **Windows: xezar moves to the next port when Windows has reserved the one it wanted.** Windows
  keeps ranges of ports for itself (Hyper-V, WSL, Docker), and they move on every restart. A port
  inside such a range used to stop the start with "permission denied"; xezar now tries the next
  port, as it does for a port in use. Linux and macOS are unchanged. (#963)
- 🐛 **Two tasks that start at the same moment no longer fail with "failed to read …/commondir".**
  Git could read the other task's working copy (Git worktree) while it was still being made. xezar
  now tries once more a moment later. (#963)
- 🐛 **macOS: cancelling or pausing a task stops the programs its agent had just started.** A
  program started in the last two seconds before the stop, such as a shell command OpenCode had
  just begun, was left running. xezar now reads the task's processes once more, for at most two seconds,
  before it stops the task; a step's time limit is unchanged. (#963)
- 🐛 **`--output lines` writes whole lines to a file or a pipe.** A long message, such as the reason
  the MCP leader bridge is unavailable, used to end in `…` at 80 characters even in a log file, where
  nothing could show the rest. Lines are now cut only on a terminal. (#963)
