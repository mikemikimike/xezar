import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * Is this test process elevated (a Windows administrator token)? GitHub's Windows runners run every
 * step elevated, and xezar refuses its MCP pipe there (#980). False on Linux and macOS, and when
 * the answer cannot be read.
 */
export function windowsElevated(): boolean {
  if (process.platform !== 'win32') return false;
  try {
    const whoami = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'whoami.exe');
    // S-1-16-12288: the High Mandatory Level an elevated token carries.
    return execFileSync(whoami, ['/groups'], { encoding: 'utf8', windowsHide: true }).includes('S-1-16-12288');
  } catch {
    return false;
  }
}
