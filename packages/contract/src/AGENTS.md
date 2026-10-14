# Guidance for `packages/contract/src/`

Cross-repository rules and the task-routing index are in the root `AGENTS.md`.

## API request/response shapes (any new field, route or payload)

**One zod definition per shape, type inferred — never a hand-written interface.** Add the schema here FIRST, then chain the route and validate through the trio; `contract-parity*.test.ts` proves the schema and the route agree in both directions, and `typed-bodies.test.ts` proves the route reached `AppType` at all. See § The HTTP API in detail below for why a loose `app.get(…)` disappears.

## The HTTP API in detail

The four invariants are summarized in root `AGENTS.md` § The HTTP API; this is the reasoning behind them.

- **Every response shape is a zod schema here, with its TypeScript type inferred from it
  (`z.infer`)** — `contract-parity*.test.ts` asserts each is mutually assignable with the route's
  own inferred type, so that half is enforced. **Request schemas belong here too**, but some are
  still declared in `server.ts` (migration progress: `docs/STATUS.md`). A migrated request schema
  is pinned against its route in both directions by `contract-parity.requests.test.ts`, the way the
  response files are. Two things travel with a migrated schema and are behaviour a type cannot
  carry, as the settings schemas (`setConfigInputSchema` / `setWorkspaceConfigInputSchema`) show:
  `systemPrompt`'s custom `'must be at most 20000 characters'` message and the shape's key order,
  which decides the field order of a multi-issue `{ error }` string. A request schema you migrate
  carries its own equivalents. When you touch a request shape, move it here and delete the local
  copy rather than editing the copy. The api-client re-exports the contract; the cockpit imports
  the schema when it wants to validate and the type when it wants to compile.
- **Register routes by chaining them into a family builder**, the way the ~30 families in
  `server.ts` already do. Hono accumulates route types through the chain only: a loose
  `app.get(…)` statement returns a value nobody keeps, so the route vanishes from `AppType` and
  the typed client cannot see it — silently, with the server still serving it.
- **Validate as route middleware.** Parsing inside a handler is invisible to hono, which is what
  let `POST /runs` accept `{ totalNonsense: 12345 }` from a typed client without complaint.

The contract describes *exactly* what the route sends — no wider, no narrower. When a schema and
its route disagree, fix the source, never widen the schema; `contract-parity*.test.ts` asserts both
directions and a one-way check passes on real drift. Two mismatches recur often enough to name:
writing `key: maybeUndefined` types a key as always-present that `JSON.stringify` drops from the
wire (spread it conditionally), and an object-literal `type: 'x'` widens to `string` during hono's
inference, erasing a discriminant consumers narrow on (`as const`).
