# Learning Effect with this repo

Goal: understand **what problem each Effect feature solves, how, when to use it, and what NOT to do**.
Every file marked below has `PROBLEM / EFFECT WAY / DON'T / WHY yield*` comments. Follow the path in order.

## Setup (once)

```bash
pnpm install
pnpm telemetry:up        # Grafana + Tempo + Loki in Docker  -> http://localhost:3001 (no login needed locally)
pnpm dev:otel            # Next.js on :3000, exporting traces/logs to Grafana
pnpm test:watch          # tests re-run on every save (vitest watch mode)

# Optional: real Postgres for the todos feature (/todos, lesson 19)
cp .env.example .env.local   # sets DATABASE_URL=postgres://effect:effect@localhost:5432/todos
pnpm db:up               # Postgres 17 in Docker, waits until healthy. Migrations run when the app starts.
```
Without Docker, `pnpm dev` works too (spans print to the console, todos live in memory).
Stop with `pnpm telemetry:down` / `pnpm db:down` (or `pnpm infra:down` for both). If port 3000 is stuck: `fuser -k 3000/tcp`.

| Database command | What it does |
|---|---|
| `pnpm db:up` | start Postgres (`localhost:5432`, user/password/db: `effect`/`effect`/`todos`) |
| `pnpm db:psql` | SQL shell inside the container (`\dt`, `SELECT * FROM todos;`, `SELECT * FROM todo_audit_log;`) |
| `pnpm db:reset` | delete the data volume and start fresh (migrations + seed run again on next start) |
| `pnpm test:db` | run all tests, including the repository contract tests against Postgres (rolled back, your data is safe) |

## The path

### Step 1: the mental model (15 min). Run the lessons

Lessons are grouped by level. `pnpm lesson` lists them; `pnpm lesson 02` runs one. Read the file first, run it second.
Each level folder has a `README.md` with talking points and a demo order (good for a presentation).

**Beginner** (`src/lessons/beginner/`, ~45 min): no prior Effect knowledge needed.

| # | Lesson | Problem it solves |
|---|---|---|
| 01 | `effect-is-a-description` | Promises run immediately and can't be wrapped; Effects are values you can retry/time out/repeat |
| 02 | `gen-and-yield` | **What `yield*` means and when to use it** |
| 03 | `fn-vs-gen-vs-pipe` | Which of `Effect.gen`, `Effect.fn`, `pipe` to use |
| 04 | `typed-errors-basics` | `throw` is invisible; tagged errors show up in the type |
| 05 | `first-service` | The declare / use / `provide` recipe for dependencies |
| 06 | `retry-basics` | Retrying and logging each attempt (`retry`, `tapError`) |

**Intermediate** (`src/lessons/intermediate/`, ~1 h):

| # | Lesson | Problem it solves |
|---|---|---|
| 07 | `typed-errors` | Several errors, `catchTags` exhaustiveness, failures vs defects |
| 08 | `services-and-layers` | Dependency injection that fails at compile time, layers that build on layers |
| 09 | `schema` | Validate + map untrusted data from one definition |
| 10 | `resilience` | Backoff, retry only transient errors, timeouts |
| 11 | `concurrency` | Bounded parallelism, race, cancellation of siblings |

**Advanced** (`src/lessons/advanced/`, ~1 h):

| # | Lesson | Problem it solves |
|---|---|---|
| 12 | `semaphores-and-fibers` | Background work, cancellation, limiting shared resources |
| 13 | `resources-scope` | Cleanup you cannot forget (success, failure, interruption) |
| 14 | `batching` | N+1 queries |
| 15 | `streams` | Big or endless data with backpressure |
| 16 | `observability` | Spans/logs without polluting business code |
| 17 | `effect-in-nextjs` | **Where services are provided in Next.js** (composition root + `ManagedRuntime`) |

**Full-stack** (`src/lessons/advanced/`, ~1 h, uses the real `src/features/todos` code):

| # | Lesson | Problem it solves |
|---|---|---|
| 18 | `http-api` | Route, fetch wrapper, response type and docs written 4 times and drifting. One `HttpApi` contract -> server + typed client + OpenAPI |
| 19 | `sql` | `any[]` rows, SQL injection, hand-rolled BEGIN/COMMIT/ROLLBACK. Typed rows, auto-joined transactions, migrations, Layer swap (needs `pnpm db:up`) |
| 20 | `queue-pubsub-schedule` | Unbounded arrays, EventEmitters, `setInterval` leaks. Backpressure, fan-out, scheduled jobs tied to a Scope |
| 21 | `testclock` | Slow/flaky tests of retries, timeouts and cron. 7s of backoff + 2 days of cron tested in ~40ms |

### Step 2: read the real feature, standard vs Effect (30 min)

Open both folders side by side: `src/features/user-profile/standard/` and `.../effect/`.

1. `domain/profile.ts`: the pure business rules (identical in both).
2. `effect/domain/errors.ts` and `effect/domain/userRepository.ts`: typed errors + the **port**.
3. `effect/application/getUserProfile.ts`: **the use case**; every `yield*` is explained.
4. `effect/infrastructure/`: the **adapters**, in this order:
   `wireSchemas.ts` -> `upstreamHttp.ts` (HttpClient, retry, timeout) -> `userRepositoryHttp.ts` ->
   `userRepositoryBatched.ts` (N+1 fix) -> `userRepositoryCached.ts` (scoped resource) -> `telemetry.ts`.
5. `effect/runtime.ts`: the **composition root**. The only place that wires things and the only `runPromise`.
6. `src/app/api/effect/profile/[id]/route.ts`: thin HTTP adapter, exhaustive `catchTags`.
7. Compare with `standard/infrastructure/httpUserClient.ts` and `standard/application/*`.

### Step 3: see it run (15 min)

Open http://localhost:3000.
- **Run both** with preset ids: 1 (flaky: retries), 5 (banned), 999 (404), 13 (hangs: timeout).
- **Batch section**: ids `1,2,1,3,999,5`. Compare "upstream calls" (standard ~17, Effect ~3). Try concurrency `2`.
- **Streams**: both links; the first lines arrive before the last page is fetched. Cancel one mid-way (close the tab).

### Step 4: look at traces (15 min)

Grafana http://localhost:3001 -> **Explore** -> datasource **Tempo** -> Search -> service `learn-effect-library`.
- Open a `getUserProfile` trace: nested spans = the call tree. Retries show as repeated `UpstreamHttp.getJson` / HTTP child spans.
- Open a `getProfiles` trace: ONE `UserResolver.batch` span with `batchSize` and `uniqueIds` attributes.
- Switch to **Loki** for the logs (same trace ids).

### Step 5: break things on purpose (the best way to learn)

1. In `getUserProfile.ts` delete the `UserBannedError` line from the route's `catchTags`: it will not compile. That is the point.
2. In `runtime.ts` remove `Layer.provide(UserRepositoryBatched)`: type error "missing UserRepository".
3. Swap `UserRepositoryBatched` for `UserRepositoryHttp` in `runtime.ts` (restart `pnpm dev`): same results, more upstream calls.
4. `UPSTREAM_FAIL_RATE=0.9 pnpm dev` and watch retries/timeouts. `UPSTREAM_RETRIES=abc pnpm dev` fails at startup with a config error.
5. Change `TTL_MS` in `userRepositoryCached.ts`, and watch the test in `infrastructure.test.ts` still pass because time is virtual.

### Step 6: full-stack Effect, the todos feature (45 min)

Open http://localhost:3000/todos (link on the home page). One feature that uses everything above, end to end:

```
TodosApi.ts (contract, Schemas)
 ├─ server:  TodosApiLive.ts -> TodoRepository (Postgres | memory) + TodoEvents (PubSub)
 │                                   └─ jobs: Queue + 2 workers (notifications), Schedule (cleanup)
 ├─ HTTP:    app/api/v2/[...path]/route.ts  (+ /api/v2/docs, /api/v2/openapi.json)
 ├─ live:    app/api/v2/events/route.ts     (PubSub -> Server-Sent Events)
 └─ browser: client/todosAtoms.ts -> app/todos/TodosApp.tsx (typed client, atoms, AsyncResult)
```

Read in this order. Every file has PROBLEM / EFFECT WAY / DON'T comments:

1. `features/todos/domain/todo.ts`: ONE schema used by server, client, DB decoding and docs.
2. `features/todos/api/TodosApi.ts` then `TodosApiLive.ts`: the contract and its handlers (no parsing, no status codes).
3. `features/todos/infrastructure/todoRepositorySql.ts` + `migrations.ts`: typed SQL, transactions, the pool as a scoped Layer.
4. `features/todos/jobs/todoJobs.ts`: Queue + workers + retry, PubSub subscriber, Schedule.
5. `features/todos/runtime.ts`: the composition root. Postgres or memory chosen by `Config` (`Layer.unwrap`).
6. `features/todos/client/todosAtoms.ts` + `app/todos/TodosApp.tsx`: the frontend. No `useEffect`, no `fetch`, typed errors.
7. Tests: `features/todos/__tests__/` (API without a server, one contract test for both adapters, jobs under TestClock).

Things to try:
- Look up id `999` on the page: the server's 404 arrives in React as a typed `TodoNotFound` with `.id`.
- Add 5 todos quickly: the live feed shows the 2 workers sharing them, with retries (`attempt 2`, `3`).
- `curl -XPOST localhost:3000/api/v2/todos -H 'content-type: application/json' -d '{"title":""}'` -> 400, the handler never ran.
- Open http://localhost:3000/api/v2/docs and call the API from there.
- `TODO_CLEANUP_INTERVAL="20 seconds" pnpm dev`: completed todos disappear every 20s (watch the feed).
- Comment out `DATABASE_URL` in `.env.local`, restart: same app, memory storage. That's the Layer swap.

#### Effect Atom in one minute (frontend)

| Regular React | Effect Atom |
|---|---|
| `useState` x3 (loading, error, data) + `useEffect(fetch)` | `useAtomValue(todosAtom)` -> one `AsyncResult` (Initial / Success / Failure) |
| `catch (e: unknown)` | `.onErrorTag("TodoNotFound", e => ...)`, `e.id` typed; unhandled cases are compile errors |
| refetch every list after a mutation by hand | mutation called with `reactivityKeys: ["todos"]`, every query with that key refreshes |
| abort controllers for unmount | an atom nobody reads is interrupted (its fetch / EventSource is closed) |

**Forms?** There is no Effect form library you need. Use react-hook-form/TanStack Form or a plain form for UI state and
validate with the SAME Schema the server uses (`Schema.decodeUnknownExit(CreateTodo)` in `TodosApp.tsx`). The
typed client also refuses to send a payload the schema rejects.

## Glossary

| Term | Meaning |
|---|---|
| **Effect<A, E, R>** | A lazy description of work: succeeds with `A`, fails with `E`, needs `R` |
| **Failure vs defect** | Failure = expected, typed (`E`); defect = bug, untyped (`die`/`throw`) |
| **Service** (`Context.Service`) | A declared dependency (interface + key). The "port" |
| **Layer** | A recipe that builds a service (the "adapter"); can depend on other layers; owns resources |
| **Scope** | A lifetime. Resources opened in it are released when it closes |
| **Fiber** | A lightweight thread of execution; effects run on fibers; interruption cancels them |
| **Schedule** | A reusable description of "when to try again / repeat" |
| **Schema** | One definition giving a type, a validator, a decoder/encoder |
| **ManagedRuntime** | Builds your Layers once and lets non-Effect code (Next.js) run Effects |
| **Request / RequestResolver** | Data describing a lookup + the code that answers many at once |
| **Stream** | A lazy, pull-based sequence of values with backpressure |
| **HttpApi** | A schema-first API contract; server handlers, typed client and OpenAPI are derived from it |
| **SqlClient** | The `sql` tagged template; values are always bind parameters; `withTransaction` nests as savepoints |
| **Queue / PubSub** | Queue: each item to ONE consumer (work sharing). PubSub: each item to EVERY subscriber (fan-out) |
| **Atom** | A reactive value for React; an Effect/Stream atom exposes an `AsyncResult` and is interrupted when unused |

## Cheat sheet: use this, not that

| You want to... | Use | Don't |
|---|---|---|
| Get a value out of an Effect | `yield*` inside `Effect.gen` / `Effect.fn` | `await`, or `yield` without `*` |
| Write a reusable function | `Effect.fn("name")(function*(){})` | arrow function returning `Effect.gen` |
| Decorate an Effect (retry, timeout, map) | `.pipe(...)` | rewrite its body |
| Fail on purpose | `return yield* new MyTaggedError(...)` | `throw`, `Effect.die` for expected cases |
| Handle errors | `Effect.catchTags({...})` | `Effect.catch(() => ...)` (swallows everything) |
| Turn failure into data | `Effect.result` / `Effect.exit` | try/catch around `yield*` |
| Call an API | `HttpClient` + `Schema` | raw `fetch` + `as User` |
| Wrap a Promise | `Effect.tryPromise({ try, catch })` | `await` inside Effect code |
| Inject a dependency | `yield* MyService` + a Layer | import a singleton / pass params everywhere |
| Run an Effect | `runtime.runPromise` **at the edge only** | `runPromise` deep inside your code |
| Limit parallelism | `forEach(..., { concurrency: n })` | `Promise.all` over unbounded input |
| Add a timer / background loop | `forkScoped` + `Schedule` | `setInterval` |
| Test with time | `TestClock.adjust` | real `sleep`s / global fake timers |
| Avoid N+1 | `RequestResolver` below the port | `getUsers(ids)` leaking into the domain |
| Build an API you also call | `HttpApi` contract + derived client | route + `fetch` + `as T` + hand-written docs |
| Query a database | `` sql`... ${value}` `` + `SqlSchema` | string concatenation, `rows as T[]` |
| Run several writes atomically | `sql.withTransaction(effect)` | BEGIN/COMMIT by hand, passing `client` around |
| Background job queue | `Queue.bounded(n)` + `forkScoped` workers | an array + `setInterval` |
| Broadcast domain events | `PubSub` + `Stream.fromPubSub` | `EventEmitter` |
| Server data in React | atoms (`useAtomValue`) + `AsyncResult.builder` | `useEffect` + `fetch` + 3 `useState`s |

## Common mistakes

1. **Forgetting `yield*`.** You get an Effect object, nothing runs, TypeScript usually complains.
2. **Mixing `await` and `yield*`.** Pick one world per function; wrap promises at the edge.
3. **Running effects too early** (`runPromise` in the middle). You lose typed errors, DI and interruption.
4. **Swallowing errors** with a catch-all. Prefer `catchTags` so new errors force a decision.
5. **`"unbounded"` concurrency on user-sized input.** Bound it.
6. **Everything in one Layer file.** Keep ports in `domain/`, adapters in `infrastructure/`, wiring in one `runtime.ts`.
7. **Expecting hot reload to rebuild Layers.** The runtime is cached on `globalThis`; restart `pnpm dev` after changing wiring.
8. **Putting `Effect.repeat` around the initial delay.** `sleep(x).pipe(andThen(job), repeat(spaced(x)))` waits 2x between runs. Repeat only the job (`jobs.test.ts` caught exactly this).
9. **Expecting the typed client to send invalid data "to test the server".** It encodes with the schema first; use curl for raw requests.
10. **Copying v3 snippets.** This repo uses **Effect v4** (`Context.Service`, `Schema.decodeUnknownEffect`, `Effect.catch`, ...). The authoritative docs are in `node_modules/effect/ai-docs/src`.

## Where to go next

- Auth middleware on the HttpApi (`HttpApiMiddleware`, see `node_modules/effect/ai-docs/src/51_http-server`).
- `SqlModel.makeRepository` + `Model.Class` to derive CRUD from one model (`ai-docs/src/40_sql`).
- OpenTelemetry metrics (counters/histograms), config providers (`.env`, JSON).
- Durable workflows and clustering (`ai-docs/src/80_cluster`).
- Read `node_modules/effect/ai-docs/src/index.md` for the full topic list.
