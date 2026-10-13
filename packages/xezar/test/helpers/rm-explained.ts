import { rmSync, type RmOptions } from 'node:fs';
import { basename } from 'node:path';
import { launchFileSync } from '../../src/platform/process-launch.ts';
import { onWindows } from './platform.ts';

/**
 * `rmSync`, and on Windows a failure also names who may still hold the folder: this process's
 * children and every process whose command line names the folder. A Windows folder a live process
 * works in cannot be removed, and the plain EBUSY/EPERM says nothing about which process (#963).
 */
export function rmTestDirExplained(dir: string, options: RmOptions): void {
  try {
    rmSync(dir, options);
  } catch (err) {
    if (!onWindows) throw err;
    let holders = '(the process list could not be read)';
    try {
      const name = basename(dir).replace(/'/g, "''");
      const script = `Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq ${process.pid} -or $_.CommandLine -like '*${name}*' } | ForEach-Object { "$($_.ProcessId) $($_.Name) $($_.CommandLine)" }`;
      holders = launchFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 30_000 }).trim() || '(none)';
    } catch {
      // keep the placeholder
    }
    throw new Error(`${(err as Error).message}\nchildren of this test process, and processes naming ${basename(dir)}:\n${holders}`, { cause: err });
  }
}
