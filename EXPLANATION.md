# Effect vs standard TypeScript: what this repo shows and what to take from it

Same feature twice (`src/features/user-profile/standard` vs `.../effect`), same layers, same HTTP behavior. Read the two folders side by side; this file is the "so what".

## The one-sentence difference

Standard TS hides **what can go wrong** and **what a function needs** inside its body. Effect moves both into the type, so the compiler checks them and you can change them in one place.

```
standard:  (client, id) => Promise<Profile>
effect:    (id) => Effect<Profile, NotFound | Upstream | InvalidResponse | Timeout | UserBanned, UserRepository>
                           ^ value   ^ every way it can fail (typed)                              ^ what it needs
```

## Where Effect is better (shown in this repo)

| Problem | Standard | Effect | Why it matters |
|---|---|---|---|
| Unknown failures | Any `throw`, invisible in signature | Errors in the type; `catchTags` is exhaustive, so a missed case doesn't compile | New error added later = compile error in every caller, not a surprise 500 in prod |
| Dependencies | Passed by hand, or imported singletons | `yield* UserRepository`, wired once in `runtime.ts` | Swap real/fake/cached implementations without touching use cases |
| Testing | Hand-passed fakes, fake timers | `Layer.succeed(fake)`, `TestClock.adjust` | Retry/timeout/TTL tests run instantly and deterministically |
| Retry/timeout | `for` loop + `AbortController` + "don't retry 404" by hand | `Effect.timeout` + `Effect.retry({ schedule, times, while })` | One policy, reusable (`resilience.ts`), hard to get subtly wrong |
| Validation + mapping | Wire type + guard + mapper, three things to keep in sync | One `Schema` (`decodeTo`, `encodeKeys`) | Single source of truth; reversible |
| Concurrency | `Promise.all` leaves the sibling request running on failure | `Effect.all` interrupts it | No leaked work, no unhandled rejections |
| Config | `process.env.X ?? default`, cast by hand | `Config.Int(...)`, validated at layer build | Bad config fails at startup, not mid-request |
| Resources | Manual dispose/cleanup code | `forkScoped` + `addFinalizer` in a Layer | Cleanup can't be forgotten |
| Observability | Logging sprinkled everywhere | `Effect.fn` / `withSpan`, swap the tracer Layer | Tracing without changing business code |

## Where standard is better (be honest)

- **Less code, instantly readable.** For one fetch + one mapper, async/await is shorter. Everyone on the team already knows it.
- **No new vocabulary.** `Effect`, `Layer`, `Context.Service`, `Schema`, `Scope`, generators: a real learning curve, and juniors/new hires need ramp-up.
- **Ecosystem fit.** Next.js, React, most libraries speak Promises. Effect needs a bridge at the edge (`runtime.ts` / `runPromise`), and you wrap library calls (`Effect.tryPromise`).
- **Bundle and tooling.** Effect adds to bundle size on the client (it's server-only here) and stack traces/debugging look different.
- **Version churn.** This repo uses Effect v4, whose API differs from v3 tutorials and AI-generated snippets. Pin versions and read the bundled docs in `node_modules/effect/ai-docs`.

## When to use it

Use Effect when most of these are true:
- Your code is mostly IO: several services, APIs, DBs, queues.
- Failure modes matter and differ (retry this, fail that, degrade there).
- You want many swappable dependencies and tests without mocking libraries.
- Long-lived processes with resources and background work.
- A team willing to learn it and keep a consistent style.

Stay with plain async/await when:
- It's a few CRUD routes, a prototype, or a short-lived script.
- The team can't invest in learning it.
- You only want typed errors: a small `Result` type plus zod covers part of that for far less.

Pragmatic middle path: use Effect only in the server/application/infrastructure layers (like here) and keep React components and simple routes plain.

## Added since the first version (see LEARNING.md)

HttpClient with schema-decoded bodies, **request batching** (`userRepositoryBatched.ts`, 17 vs ~3 upstream calls in the demo),
bounded concurrency + hedged requests, **Streams** (NDJSON with backpressure/cancellation), OTLP traces/logs to Grafana
(`docker-compose.yml`, `telemetry.ts`), and 21 runnable lessons in three levels (`pnpm lesson`).

**Full-stack todos feature** (`/todos`, `src/features/todos`, lessons 18-21):
- **HttpApi**: one schema-first contract gives the Next.js handlers, a typed browser client and OpenAPI docs (`/api/v2/docs`).
  Errors keep their type across the network (a 404 is decoded back into `TodoNotFound`).
- **effect/sql + Postgres** (`pnpm db:up`): tagged-template SQL (always parameterised), schema-decoded rows,
  `withTransaction` (todo + audit row together; nests as savepoints), migrations as Effects, the pool as a scoped Layer.
  Postgres or memory is chosen by `Config`; one contract test suite runs against both.
- **Queue / PubSub / Schedule**: notification workers with backpressure and retry, fan-out of domain events to a
  live SSE feed, a scheduled cleanup job. All fibers are scoped, so nothing leaks on shutdown or hot reload.
- **TestClock**: retries, the 2-minute schedule and worker parallelism tested in milliseconds.
- **Effect Atom** in React: atoms replace `useEffect` + `fetch` + loading/error state. Results are one `AsyncResult`,
  errors are typed, a mutation refreshes queries via `reactivityKeys`, unused atoms are interrupted.

### Effect on the frontend: honest take
Atoms shine for **server data**: typed errors from the API contract, automatic cancellation, refresh after mutations,
streams (the live feed is a 15-line atom). They add little for local UI state (`useState` is fine) or forms: there is
no "Effect form library" you need. Keep react-hook-form / TanStack Form / plain forms, and validate with the same Schema
the server uses (see `TodosApp.tsx`). The cost: another mental model in the React layer and a larger client bundle,
since part of `effect` ships to the browser. Many teams use Effect on the server only and are perfectly happy.

## What this repo still does NOT show (real problems Effect solves)

Streams, batching, semaphores, fibers, caching, hedged requests, OTLP telemetry, HttpApi, SQL with transactions and
migrations, Queue/PubSub/Schedule, TestClock and Effect Atom are all shown now. Not demonstrated yet:

1. **Rate limiting**: `RateLimiter` in front of a rate-limited upstream.
2. **Workflows and durable execution**: sagas, retries across restarts (`effect/unstable` cluster/workflow, `ai-docs/src/80_cluster`).
3. **Auth middleware** on the HttpApi (`HttpApiMiddleware`, `HttpApiSecurity`), RPC (`AtomRpc`), SSR hydration of atoms.
4. **CLI and AI integrations** (`ai-docs/src/70_cli`, `71_ai`).
5. **Property-based tests** generated from Schemas (`@effect/vitest` `it.effect.prop`).

Typical real problems these fix: duplicate or leaked requests under load, retry storms against a failing dependency, cleanup bugs on shutdown, N+1 calls, inconsistent error handling across a large codebase, and untestable time-dependent logic.

## Suggested next steps

1. Put auth middleware on `TodosApi` and see the client get a typed `Unauthorized`.
2. Add a rate limiter in front of the upstream.
3. Move one more feature over and judge the cost/benefit with your team before committing broadly.
