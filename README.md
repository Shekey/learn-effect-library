# Effect vs standard TypeScript — one feature, two implementations

Feature: build a user **profile** from two upstream calls (user + posts). The "upstream" is a flaky Next route (`/api/upstream/*`).
Try it: `pnpm dev` → http://localhost:3000 (use port 3000, or set `UPSTREAM_URL`). `pnpm test` / `pnpm test:watch` for tests.
**New here? Start with [LEARNING.md](./LEARNING.md)** (guided path, glossary, use/don't-use cheat sheet) and run `pnpm lesson`.
Telemetry: `pnpm telemetry:up` then `pnpm dev:otel`, open Grafana at http://localhost:3001 (Explore → Tempo/Loki).
Full-stack demo: http://localhost:3000/todos (HttpApi + typed client, Effect Atom, Queue/PubSub/Schedule). For real
Postgres: `cp .env.example .env.local && pnpm db:up`, then `pnpm dev` (without it, todos are kept in memory).

```
src/features/user-profile/
  domain/                 shared pure rules: canViewProfile(), toProfile()  (no deps)
  presentation/           ProfileDto + toProfileDto (API response shape)
  standard/  domain · application · infrastructure              (async/await, throw)
  effect/    domain · application · infrastructure · runtime.ts (Effect, Layers)
src/app/api/{standard,effect}/profile/[id]   thin HTTP adapters
src/app/api/upstream/*                       fake external service (incl. batch + paginated endpoints)
src/features/todos/
  domain/ · api/ (HttpApi contract + handlers) · infrastructure/ (Postgres | memory, migrations)
  jobs/ (Queue workers, Schedule) · client/ (atoms) · runtime.ts · __tests__/
src/app/api/v2/[...path]   the whole todos API (+ /api/v2/docs, /api/v2/openapi.json); /api/v2/events = live SSE
src/app/todos              React page using Effect Atom
src/lessons/{beginner,intermediate,advanced}/ 21 runnable lessons: `pnpm lesson 02` (see each folder's README)
docker-compose.yml                           Grafana + Tempo + Loki (OTLP on :4318), Postgres 17 (:5432)
```
Data flow: upstream wire JSON (snake_case) → *infrastructure maps to* domain `User/Post` → *application* applies rules → `Profile` → *API edge maps to* `ProfileDto`.
Dependencies point inward: `app/api → application → domain ← infrastructure`.

## What Effect changes (compare the two folders)

| Concern | Standard | Effect |
|---|---|---|
| Errors | `Promise<Profile>`; any throw, invisible in types | `Effect<Profile, NotFound \| Upstream \| …, UserRepository>`; errors are part of the type |
| Handling errors | `instanceof` chain; a missed case becomes a 500 | `catchTags`; `runHttp` only accepts `never` errors, so a missed case fails to compile |
| Dependencies | passed manually (`getUserProfile(client, id)`) | `yield* UserRepository`; tracked in the type, wired once in `runtime.ts` |
| Testing | pass a fake by hand | `Effect.provide(Layer.succeed(...))`, use case untouched |
| Retry / timeout | `for` loop + `AbortController` + manual "don't retry 404" | `Effect.timeout` + `Effect.retry({ schedule, times, while })` |
| Validation + wire→domain mapping | wire type + guard + mapper written by hand (3 things to keep in sync) | one `Schema` (`decodeTo` / `encodeKeys`) validates, renames, maps, and can encode back |
| Domain rule failures | `throw new UserBannedError` (invisible in types) | `yield* new UserBannedError(...)` shows up in the signature and `catchTags` must handle it |
| Config | `process.env.X ?? default`, cast by hand, bad values surface mid-request | `Config.Int("UPSTREAM_RETRIES")` typed + validated + defaulted, fails at layer build |
| Resources / lifecycle | manual `setInterval` + dispose hooks | `forkScoped` + `addFinalizer` inside a Layer: started on build, cleaned up on shutdown |
| Composition | wrapper classes wired by hand | decorator Layer: `UserRepositoryCached` requires a `UserRepository` and provides one (`runtime.ts`) |
| Observability | add logging by hand everywhere | `Effect.fn` / `withSpan` spans; swap the tracer Layer (`consoleTracer.ts` → OTLP) with no use-case changes |
| Testing time | fake timers / real sleeps | `TestClock.adjust("10 seconds")`: backoff, timeout and TTL tests run instantly (`infrastructure.test.ts`) |
| Concurrency | `Promise.all` keeps the sibling request running on failure | `Effect.all` interrupts the sibling automatically |

## When to use it
Lots of IO, failure modes that matter, retries/timeouts/concurrency, many swappable dependencies, tests without mocking libs.
Cost: a learning curve and a different style; for a tiny CRUD route plain async/await is fine.

Demo ids: `1` flaky (retries visible in the server log), `5` → banned → 403, `999` → 404, `13` → hangs → 504.
