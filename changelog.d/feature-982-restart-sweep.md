## 🐛 Fixes

- 🐛 **A task that was running when xezar crashed no longer leaves its programs running.** When xezar
  stopped without a clean shutdown, a shell command, a build or a dev server the task's agent had
  started kept running, and the restarted xezar resumed the task beside it. The restarted xezar now
  stops what the interrupted turn left before the task resumes, and says so in the task, as a cancel
  already does. On Windows and macOS xezar keeps a small list of each running task's processes in the
  task's files for this; it is removed when the task ends. This clean-up may take up
  to 30 seconds, because the first process read after a start is slow on Windows. (#982)
