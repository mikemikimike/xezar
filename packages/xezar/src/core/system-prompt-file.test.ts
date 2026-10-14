import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeSystemPromptFile } from './system-prompt-file.ts';

describe('writeSystemPromptFile (#1008)', () => {
  it('writes the exact text to a private file and removes its directory on cleanup', () => {
    const text = `# Role\n\n${'Długi tekst – '.repeat(3_000)}\n`;
    const file = writeSystemPromptFile(text);
    expect(file).not.toBeNull();
    if (!file) return;
    expect(readFileSync(file.path, 'utf8')).toBe(text);
    file.cleanup();
    expect(existsSync(dirname(file.path))).toBe(false);
    // Idempotent: the child's `exit` and `close` both call it.
    expect(() => file.cleanup()).not.toThrow();
  });

  it('gives every call its own directory, so two runs never share a file', () => {
    const a = writeSystemPromptFile('a');
    const b = writeSystemPromptFile('b');
    try {
      expect(a?.path).not.toBe(b?.path);
    } finally {
      a?.cleanup();
      b?.cleanup();
    }
  });
});
