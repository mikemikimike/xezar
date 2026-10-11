import { describe, expect, it } from 'vitest';
import { portTaken } from './port-taken.ts';

describe('portTaken (#963)', () => {
  it('counts a port Windows reserved for itself as taken', () => {
    expect(portTaken('EADDRINUSE', 'win32')).toBe(true);
    expect(portTaken('EACCES', 'win32')).toBe(true);
  });

  it('GUARD: Linux and macOS keep EADDRINUSE only – EACCES there is a privileged port', () => {
    for (const platform of ['linux', 'darwin'] as const) {
      expect(portTaken('EADDRINUSE', platform)).toBe(true);
      expect(portTaken('EACCES', platform)).toBe(false);
    }
  });

  it('never counts another error as taken', () => {
    for (const platform of ['win32', 'linux', 'darwin'] as const) {
      expect(portTaken('EADDRNOTAVAIL', platform)).toBe(false);
      expect(portTaken(undefined, platform)).toBe(false);
    }
  });
});
