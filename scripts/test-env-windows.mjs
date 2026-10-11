#!/usr/bin/env node
// Windows only: the test-env scripts' process identity and stop, through the product's own
// platform layer (the build in packages/xezar/dist). A pid alone is not an identity on Windows –
// pids are reused within seconds – so the descriptor also records the app's start time, and a stop
// ends that exact process and its creation-filtered descendants, killed by start time in one
// PowerShell. Never `taskkill /T`, which follows stale parent pids into unrelated processes.
//
//   start-time <pid>          print the start time (ms) of <pid>; exit 1 when unreadable
//   alive <pid> <startedAt>   exit 0 only when <pid> is still the process that started then
//   stop <pid> <startedAt>    stop that process and its tree; exit 0 when nothing of it is left
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (file) => import(pathToFileURL(join(root, 'packages/xezar/dist/platform', file)).href);
const TIMEOUT_MS = 10_000;

const [command, pidText, startedText] = process.argv.slice(2);
const positive = (text) => (typeof text === 'string' && /^[1-9]\d{0,15}$/.test(text) ? Number(text) : null);
const pid = positive(pidText);
if (process.platform !== 'win32' || pid === null) process.exit(2);

const table = await load('process-table.js');
const rowOf = (rows) => rows.find((row) => row.pid === pid);

async function readRow() {
  const read = await table.readProcessTable({ timeoutMs: TIMEOUT_MS });
  if (!read) throw new Error('the process table could not be read');
  return rowOf(read.rows);
}

if (command === 'start-time') {
  const row = await readRow();
  if (row?.startedAt === undefined) process.exit(1);
  process.stdout.write(String(row.startedAt));
  process.exit(0);
}

const startedAt = positive(startedText);
if (startedAt === null) process.exit(2);
const same = (row) => row !== undefined && row.startedAt === startedAt;

if (command === 'alive') process.exit(same(await readRow()) ? 0 : 1);

if (command === 'stop') {
  const { readTableThenKill } = await load('table-then-kill.js');
  const result = await readTableThenKill(
    (snapshot) =>
      same(rowOf(snapshot.rows))
        ? [{ pid, startedAt }, ...table.descendantTargets(snapshot.rows, { pid, spawnedAt: startedAt, stoppedAt: snapshot.queriedAt })]
        : [],
    { timeoutMs: TIMEOUT_MS },
  );
  if (!result) {
    console.error('[test-env] the process table could not be read – nothing stopped');
    process.exit(1);
  }
  for (let tries = 0; tries < 20; tries++) {
    if (!same(await readRow())) process.exit(0);
    await new Promise((done) => setTimeout(done, 500));
  }
  process.exit(1);
}

process.exit(2);
