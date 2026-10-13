/**
 * #982: an engine that died mid-turn left the turn's programs running, and the engine started
 * after it had no proof of which processes were the run's. Windows and macOS now save each run's
 * ledger beside its files; `recover()` reads it back and sweeps under the same identity rules.
 * Linux needs no file: the marker in `/proc` still proves it.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_DIR_RM_OPTIONS } from '../../test/helpers/platform.ts';
import { RunProcessLedger } from './run-process-ledger.ts';
import { RUN_MARKER_ENV, RunProcessSweeper } from './run-process-sweeper.ts';
import { FakeMachine } from './run-process-sweeper.testkit.ts';

const RUN = '11111111-2222-4333-8444-555555555555';
const OTHER_RUN = '99999999-2222-4333-8444-555555555555';
const T0 = 1_800_000_000_000;
const XEZAR = 50;
const ROOT = 300;
const CHILD = 301;

let dir: string;

beforeEach(() => {
  vi.useFakeTimers({ now: T0 + 100_000 });
  dir = mkdtempSync(join(tmpdir(), 'xez-982-'));
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, TEST_DIR_RM_OPTIONS);
});

const savedFile = (runId: string): string => join(dir, `${runId}.processes.json`);

function machineFor(platform: NodeJS.Platform): FakeMachine {
  return new FakeMachine(platform, XEZAR).add(
    { pid: 1, ppid: 0, startedAt: T0 - 9_000_000 },
    { pid: XEZAR, ppid: 1, startedAt: T0 - 50_000 },
  );
}

function engine(machine: FakeMachine, ledgerDir: string | null = dir): { sweeper: RunProcessSweeper; reports: string[] } {
  const reports: string[] = [];
  const sweeper = new RunProcessSweeper(
    { report: (_runId, text) => reports.push(text), ...(ledgerDir === null ? {} : { ledgerDir }) },
    machine.deps(),
  );
  return { sweeper, reports };
}

/** The first engine: a run whose agent started a program, recorded by one sampler read. */
async function firstEngineRecords(machine: FakeMachine): Promise<RunProcessSweeper> {
  const { sweeper } = engine(machine);
  machine.add({ pid: ROOT, ppid: XEZAR, startedAt: T0, cmdline: 'node claude.js' });
  machine.add({ pid: CHILD, ppid: ROOT, startedAt: T0 + 1_000, cmdline: 'node dev-server.js' });
  sweeper.pinRoot(RUN, ROOT, T0 + 500);
  machine.tick();
  await sweeper.filesSettled();
  return sweeper;
}

async function settle(sweeper: RunProcessSweeper, sweep: Promise<void>): Promise<void> {
  await vi.runAllTimersAsync();
  await sweep;
  await sweeper.filesSettled();
}

describe('a saved ledger survives the engine (#982)', () => {
  for (const platform of ['win32', 'darwin'] as const) {
    it(`${platform}: the engine started after a crash stops what the interrupted turn left`, async () => {
      const machine = machineFor(platform);
      await firstEngineRecords(machine);
      expect(existsSync(savedFile(RUN))).toBe(true);
      // The engine dies: nothing stops its children, and its agent exits with it.
      machine.processes.get(XEZAR)!.alive = false;
      machine.processes.get(ROOT)!.alive = false;
      machine.add({ pid: 60, ppid: 1, startedAt: T0 + 200_000 });
      const next = new FakeMachine(platform, 60);
      for (const proc of machine.processes.values()) next.add(proc);

      const { sweeper, reports } = engine(next);
      await settle(sweeper, sweeper.recover(RUN));

      if (platform === 'win32') expect(next.killRequests.flat()).toEqual([{ pid: CHILD, startedAt: T0 + 1_000 }]);
      else expect(next.signals).toContainEqual([CHILD, 'SIGTERM']);
      expect(next.isAlive(CHILD)).toBe(false);
      expect(reports).toEqual([`Stopped 1 program this task started: ${CHILD} node dev-server.js.`]);
      expect(existsSync(savedFile(RUN))).toBe(false);
    });
  }

  it('a pid now held by a later process counts for nothing', async () => {
    const machine = machineFor('win32');
    await firstEngineRecords(machine);
    machine.processes.get(ROOT)!.alive = false;
    machine.processes.set(CHILD, { pid: CHILD, ppid: 1, startedAt: T0 + 90_000, alive: true, cmdline: 'node unrelated.js' });

    const { sweeper, reports } = engine(machine);
    await settle(sweeper, sweeper.recover(RUN));

    expect(machine.killRequests.flat()).toEqual([]);
    expect(machine.isAlive(CHILD)).toBe(true);
    expect(reports).toEqual([]);
  });

  it('an unreadable or foreign file means nothing to sweep, reads no table, and is removed', async () => {
    for (const text of ['not json', '{"v":2,"seen":[],"groups":[]}', '{"v":1,"seen":[[1,"x",3]],"groups":[]}', '[]']) {
      const machine = machineFor('win32');
      let reads = 0;
      writeFileSync(savedFile(RUN), text);
      const sweeper = new RunProcessSweeper(
        { report: () => undefined, ledgerDir: dir },
        machine.deps({ readTable: async () => { reads += 1; return machine.table(); } }),
      );
      await settle(sweeper, sweeper.recover(RUN));
      expect(reads, text).toBe(0);
      expect(existsSync(savedFile(RUN)), text).toBe(false);
    }
  });

  it('a run that ends, is cancelled or is paused leaves no saved ledger; a timeout keeps it', async () => {
    const machine = machineFor('win32');
    const sweeper = await firstEngineRecords(machine);
    await settle(sweeper, sweeper.now(RUN, 'timeout'));
    expect(existsSync(savedFile(RUN))).toBe(true);
    sweeper.start(RUN, 'cancel');
    await settle(sweeper, sweeper.pending(RUN) ?? Promise.resolve());
    expect(existsSync(savedFile(RUN))).toBe(false);

    sweeper.pinRoot(RUN, ROOT, T0 + 500);
    machine.processes.get(ROOT)!.alive = true;
    machine.tick();
    await sweeper.filesSettled();
    expect(existsSync(savedFile(RUN))).toBe(true);
    sweeper.drop(RUN);
    await sweeper.filesSettled();
    expect(existsSync(savedFile(RUN))).toBe(false);
  });

  it('at start-up, forgets every saved ledger but the running runs’ ones', async () => {
    writeFileSync(savedFile(RUN), '{}');
    writeFileSync(savedFile(OTHER_RUN), '{}');
    writeFileSync(join(dir, `${RUN}.ndjson`), '');
    const { sweeper } = engine(machineFor('win32'));
    sweeper.forgetSavedExcept([RUN]);
    await sweeper.filesSettled();
    expect(existsSync(savedFile(RUN))).toBe(true);
    expect(existsSync(savedFile(OTHER_RUN))).toBe(false);
    expect(existsSync(join(dir, `${RUN}.ndjson`))).toBe(true);
  });

  it('saves only what it proves, and nothing without a folder', async () => {
    const machine = machineFor('win32');
    await firstEngineRecords(machine);
    const saved = JSON.parse(readFileSync(savedFile(RUN), 'utf8'));
    expect(saved).toEqual({ v: 1, seen: [[ROOT, T0, T0 + 100_000], [CHILD, T0 + 1_000, T0 + 100_000]], groups: [] });

    const other = machineFor('win32');
    rmSync(savedFile(RUN));
    const { sweeper } = engine(other, null);
    other.add({ pid: ROOT, ppid: XEZAR, startedAt: T0 });
    sweeper.pinRoot(RUN, ROOT, T0 + 500);
    other.tick();
    await sweeper.filesSettled();
    expect(existsSync(savedFile(RUN))).toBe(false);
  });

  it('linux: proves the leftovers by the marker, with no file at all', async () => {
    const machine = machineFor('linux');
    machine.add({ pid: 4121, ppid: 1, startedAt: T0 + 1, environ: [`${RUN_MARKER_ENV}=${RUN}`], cmdline: 'node server.js' });
    const { sweeper, reports } = engine(machine);
    await settle(sweeper, sweeper.recover(RUN));
    expect(machine.signals).toContainEqual([4121, 'SIGTERM']);
    expect(reports).toEqual(['Stopped 1 program this task started: 4121 node server.js.']);
  });
});

describe('RunProcessLedger.snapshot / restore (#982)', () => {
  it('round-trips what the ledger proves', () => {
    const ledger = new RunProcessLedger();
    ledger.pin(ROOT, T0);
    ledger.record({ rows: [{ pid: ROOT, ppid: XEZAR, rssKb: 1, cpuPct: 0, startedAt: T0 }, { pid: CHILD, ppid: ROOT, rssKb: 1, cpuPct: 0, startedAt: T0 + 5 }], queriedAt: T0 + 10 });
    const back = RunProcessLedger.restore(JSON.parse(JSON.stringify(ledger.snapshot())));
    expect(back?.snapshot()).toEqual(ledger.snapshot());
    expect(back?.has(CHILD)).toBe(true);
  });

  it('refuses anything that is not its own shape', () => {
    for (const value of [null, 1, 'x', {}, { v: 1 }, { v: 1, seen: [[1, 2]], groups: [] }, { v: 1, seen: [], groups: [[1, -2]] }, { v: 1, seen: [[1.5, 2, 3]], groups: [] }]) {
      expect(RunProcessLedger.restore(value), JSON.stringify(value)).toBeNull();
    }
  });
});
