#!/usr/bin/env node
// Windows only: the test-env scripts' process identity and stop. A pid alone is not an identity on
// Windows – pids are reused within seconds – so the descriptor also records the app's start time,
// and a stop ends that exact process and its creation-filtered descendants, each killed only while
// its start time still matches. Never `taskkill /T`, which follows stale parent pids into
// unrelated processes.
//
// Self-contained on purpose: it runs before the product is built (a cold boot stops a stale
// instance first, and the launcher's own tests run before the build), so it cannot import
// packages/xezar/dist. It mirrors the product's rules in packages/xezar/src/platform/
// (process-table.ts: the creation-filtered walk and the kill-by-start-time loop). Each command is
// ONE PowerShell run, because a cold PowerShell costs seconds on a busy machine.
//
//   start-time <pid>          print the start time (ms) of <pid>; exit 1 when it is not running
//   alive <pid> <startedAt>   exit 0 only when <pid> is still the process that started then
//   stop <pid> <startedAt>    stop that process and its tree; print `stopped` or `gone` and exit 0
//                             when that process is no longer running, else exit 1
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const TIMEOUT_MS = 30_000;

const START_MS = 'function StartMs($p) { [long][Math]::Floor(($p.StartTime.ToFileTimeUtc() - 116444736000000000) / 10000) }';

/** The pid's start time in ms, or `-`. The pid arrives by environment, so the text never changes. */
const START_SCRIPT = [
  START_MS,
  "try { $p = [Diagnostics.Process]::GetProcessById([int]$env:TEST_ENV_PID) } catch { '-'; exit }",
  "try { StartMs $p } catch { '-' } finally { $p.Dispose() }",
].join('\n');

/**
 * Stop: the root only while its start still matches; its descendants from one table read, a direct
 * child created no earlier than 1 s before the root and every deeper one no earlier than its
 * parent; each killed only while its own start still matches. Prints `gone` or `stopped`/`running`.
 */
const STOP_SCRIPT = [
  "$ProgressPreference = 'SilentlyContinue'",
  START_MS,
  '$root = [int]$env:TEST_ENV_PID; $want = [long]$env:TEST_ENV_STARTED',
  "try { $r = [Diagnostics.Process]::GetProcessById($root) } catch { 'gone'; exit }",
  "try { if ($r.HasExited -or [Math]::Abs((StartMs $r) - $want) -gt 1) { 'gone'; exit } } catch { 'gone'; exit }",
  '$rows = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate | Where-Object { $_.CreationDate } | ForEach-Object {',
  '  [pscustomobject]@{ Id = [int]$_.ProcessId; Parent = [int]$_.ParentProcessId; Start = [long][Math]::Floor(($_.CreationDate.ToFileTimeUtc() - 116444736000000000) / 10000) }',
  '})',
  '$targets = New-Object System.Collections.ArrayList',
  '$seen = @{}; $seen[$root] = $true',
  '$stack = New-Object System.Collections.Stack',
  'foreach ($row in $rows) { if ($row.Parent -eq $root -and $row.Start -ge $want - 1000) { $stack.Push($row) } }',
  'while ($stack.Count -gt 0) {',
  '  $row = $stack.Pop()',
  '  if ($seen.ContainsKey($row.Id)) { continue }',
  '  $seen[$row.Id] = $true; [void]$targets.Add($row)',
  '  foreach ($c in $rows) { if ($c.Parent -eq $row.Id -and $c.Start -ge $row.Start) { $stack.Push($c) } }',
  '}',
  'try { $r.Kill() } catch {}',
  'foreach ($row in $targets) {',
  '  try { $p = [Diagnostics.Process]::GetProcessById($row.Id) } catch { continue }',
  '  try { if (-not $p.HasExited -and [Math]::Abs((StartMs $p) - $row.Start) -le 1) { $p.Kill() } } catch {} finally { $p.Dispose() }',
  '}',
  "try { if ($r.WaitForExit(5000)) { 'stopped' } else { 'running' } } catch { 'stopped' } finally { $r.Dispose() }",
].join('\n');

const positive = (text) => (typeof text === 'string' && /^[1-9]\d{0,15}$/.test(text) ? Number(text) : null);
const [command, pidText, startedText] = process.argv.slice(2);
const pid = positive(pidText);
if (process.platform !== 'win32' || pid === null || !process.env.SystemRoot) process.exit(2);
const powershell = join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

function runPowerShell(script, extraEnv) {
  return execFileSync(
    powershell,
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { encoding: 'utf8', timeout: TIMEOUT_MS, windowsHide: true, env: { ...process.env, TEST_ENV_PID: String(pid), ...extraEnv } },
  ).trim();
}

try {
  if (command === 'start-time') {
    const text = runPowerShell(START_SCRIPT);
    if (!/^\d+$/.test(text)) process.exit(1);
    process.stdout.write(text);
    process.exit(0);
  }
  const startedAt = positive(startedText);
  if (startedAt === null) process.exit(2);
  if (command === 'alive') {
    const text = runPowerShell(START_SCRIPT);
    process.exit(/^\d+$/.test(text) && Math.abs(Number(text) - startedAt) <= 1 ? 0 : 1);
  }
  if (command === 'stop') {
    const state = runPowerShell(STOP_SCRIPT, { TEST_ENV_STARTED: String(startedAt) }).split(/\r?\n/).at(-1);
    process.stdout.write(state ?? '');
    process.exit(state === 'stopped' || state === 'gone' ? 0 : 1);
  }
} catch (error) {
  console.error(`[test-env] ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
  process.exit(1);
}
process.exit(2);
