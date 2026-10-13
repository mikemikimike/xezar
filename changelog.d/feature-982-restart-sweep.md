## 🐛 Fixes

- 🐛 **A task that was running when xezar crashed no longer leaves its programs running.** When xezar
  stopped without a clean shutdown, a shell command, a build or a dev server the task's agent had
  started kept running, and the restarted xezar resumed the task beside it. The restarted xezar now
  stops what the interrupted turn left before the task resumes, and says so in the task, as a cancel
  already does. On Windows and macOS xezar keeps a small list of each running task's processes beside the
  task's files (`<runId>.processes.json`); it is removed when the task ends, is cancelled or
  paused, or no longer runs when xezar starts. Linux needs no list. The resumed task waits up to
  30 seconds for this clean-up, because the first process read after a start is slow on Windows; a
  cancel or pause still waits at most 10 seconds. (#982)
