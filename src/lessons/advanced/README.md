# Advanced (about 1 hour)

Goal: understand what makes Effect shine in long-running servers: cancellation, cleanup, batching, streaming, tracing,
and how it all plugs into Next.js. Prerequisite: beginner and intermediate.

Every lesson prints two sections: **regular way** (plain async/await) first, then **Effect way**. Present them
in that order. Show the pain, then the fix. The "regular" code is in the same file, above the Effect code.

| # | What the regular way shows |
|---|---|
| 12 | A hand-written limiter (counter + queue + `finally`). The Effect side has **4 demos**: fibers, Semaphore(1) lock, Semaphore(2) for API calls, Semaphore(3) with weighted permits (heavy job = 2) |
| 13 | try/finally + `clearInterval`, and nothing is told when the caller gives up |
| 14 | A hand-rolled DataLoader: queue, timer, dedupe, fan-out, no error handling |
| 15 | An async generator: every operator is a loop |
| 16 | `performance.now()` timing mixed into business code |
| 17 | A module singleton per route vs one `ManagedRuntime` + `runHttp` |
| 18 | `fetch` + `as TodoDto` + `throw new Error("HTTP 404")` |
| 19 | `pool.query("..." + input)`, `any[]` rows, BEGIN/COMMIT/ROLLBACK by hand |
| 20 | An array as a queue (1000 jobs instantly), `setInterval` you must remember to clear |
| 21 | Real `setTimeout` waits in a retry test |
| 22 | Arrays and callbacks: everything loaded at once, push with no way to say "slow down" |
| 23 | A producer filling an unbounded array while the consumer lags |
| 24 | A CSV import written as hand-made loops, batching and error counting |
| 25 | `try/catch` that loses defects, interruptions and the second error |
| 26 | A service accidentally built twice |

| # | Lesson | Talking points | Live demo |
|---|---|---|---|
| 12 | semaphores-and-fibers | Fibers form a tree, `forkChild` / `join` / `interrupt`. A Semaphore limits a shared resource | `pnpm lesson 12` |
| 13 | resources-scope | `acquireRelease` cleanup runs on success, failure AND interruption | run it, read the three paths |
| 14 | batching | Callers ask one at a time, a `RequestResolver` receives them together (5 requests, 1 call, deduped) | `pnpm lesson 14` |
| 15 | streams | Lazy and pull-based: a billion items, three computed | `pnpm lesson 15` |
| 16 | observability | `Effect.fn` makes spans; where they go is a Layer (console here, OTLP -> Grafana in the app) | `pnpm telemetry:up && pnpm dev:otel` |
| 17 | effect-in-nextjs | **Where is `provide`?** Once, at the composition root: `AppLayer` -> `ManagedRuntime` -> `runHttp` | open `effect/runtime.ts` and a route side by side |
| 18 | http-api | One contract, three outputs. A 404 crosses the network as a typed `TodoNotFound` | `pnpm lesson 18`, then `/api/v2/docs` |
| 19 | sql | Bind parameters (`compile()` shows `$1`), nested transaction rolled back, same program on memory and Postgres | `pnpm db:up && pnpm lesson 19`, then `pnpm db:psql` |
| 20 | queue-pubsub-schedule | Producer WAITS when the queue is full; PubSub publisher doesn't wait for slow subscribers | `pnpm lesson 20`, then add 5 todos on `/todos` |
| 21 | testclock | Fork, `TestClock.adjust`, assert. 7s retries + 2 days of cron in ~40ms | `pnpm lesson 21`, then `pnpm test` |
| 22 | streaming-101 | Pull vs push, lazy, chunks, hot vs cold. Read [concept 01](../../../docs/concepts/01-streaming.md) first | `pnpm lesson 22` |
| 23 | backpressure | Bounded buffers: suspend / dropping / sliding. Read [concept 02](../../../docs/concepts/02-backpressure.md) first | `pnpm lesson 23` |
| 24 | stream-toolbox | Real operators on a CSV import | `pnpm lesson 24`, then `/csv-import` |
| 25 | errors-and-cause | Fail vs die vs interrupt, reading a `Cause`. Read [concept 04](../../../docs/concepts/04-errors-and-cause.md) first | `pnpm lesson 25` |
| 26 | layer-memoization | Same Layer value = built once (MemoMap), `Layer.fresh`. Read [concept 05](../../../docs/concepts/05-layers-and-memoization.md) first | `pnpm lesson 26` |

Suggested slide order: 17 first as the "big picture", then 12 -> 13 -> 14 -> 15 -> 16 as the deep dives.
Deep dives: 22 -> 23 -> 24 (streams), 25 (errors), 26 (layers); concept docs in `docs/concepts/README.md`.
Full-stack block: 18 -> 19 -> 20 -> 21, then open `/todos` and walk through `src/features/todos` (LEARNING.md step 6).

Finish the presentation with the real app: `pnpm dev`, then hit `/api/standard/profiles` vs `/api/effect/profiles`
(see `LEARNING.md` step 2 onwards) to compare upstream call counts, retries and cancellation.
