// ─────────────────────────────────────────────────────────────────────────────
// BACKGROUND WORK, three classic shapes:
//
//  1. PubSub subscriber  (fan-out)       every TodoCreated event is also seen by the live feed, the audit log...
//  2. Queue + N workers  (work sharing)  each notification job is taken by EXACTLY ONE worker
//  3. Schedule           (periodic)      cleanup of completed todos every TODO_CLEANUP_INTERVAL
//
// PROBLEM (regular way): `setInterval(cleanup, 60000)` + `emitter.on("created", sendEmail)` + an in-memory array
//   as a queue. Who stops the interval on shutdown or hot reload? What if sendEmail throws? What if 10,000
//   events arrive at once (unbounded memory)? How do you test "runs every 2 minutes" without waiting?
// EFFECT WAY:
//   - every loop is a FIBER started with `forkScoped`: when the layer's scope closes (runtime.dispose(), test
//     end, hot reload), all of them are interrupted. Nothing leaks.
//   - `Queue.bounded(10)`: when full, `offer` WAITS (backpressure) instead of growing forever.
//   - `Effect.retry(Schedule...)` and `Effect.repeat(Schedule...)` are data, so tests drive them with TestClock.
// DON'T: use `forkDetach` for app jobs (nothing would stop them), or an unbounded queue for user-driven input.
// ─────────────────────────────────────────────────────────────────────────────
import { Config, Effect, Layer, Queue, Ref, Schedule, Stream } from "effect"
import type { Todo } from "../domain/todo"
import { TodoEvents } from "../domain/todoEvents"
import { TodoRepository } from "../domain/todoRepository"
import { Notifier } from "./notifier"

export const WORKERS = 2

// Retry policy as a value: up to 3 retries, 200ms -> 400ms -> 800ms. Reused by the lesson and the tests.
export const notifyRetryPolicy = { schedule: Schedule.exponential("200 millis"), times: 3 }

export const NotificationWorkers = Layer.effectDiscard(
  Effect.gen(function*() {
    const events = yield* TodoEvents
    const notifier = yield* Notifier
    const queue = yield* Queue.bounded<Todo>(10)

    // PRODUCER: subscribe to the PubSub, keep only TodoCreated, push into the queue.
    // If both workers are busy and 10 jobs are waiting, `Queue.offer` suspends this fiber until there is room.
    yield* events.subscribe.pipe(
      Stream.filter((e) => e._tag === "TodoCreated"),
      Stream.runForEach((e) => Queue.offer(queue, e.todo)),
      Effect.forkScoped,
    )

    // CONSUMERS: WORKERS fibers, each taking one job at a time. A job that still fails after all retries is
    // logged and dropped: one bad notification never kills the worker (that is what `catch` is for here).
    const worker = (n: number) =>
      Effect.gen(function*() {
        const todo = yield* Queue.take(queue)
        // Attempt counter as a `Ref`, created fresh for EACH job (it lives inside this per-job generator).
        // PROBLEM (regular way): `let attempt = 0` + `Effect.suspend(() => (attempt++, send()))`. It works, but
        //   it hides a side effect inside a thunk, relies on `suspend` re-running it on every retry, and is not
        //   safe if the effect is ever shared between fibers.
        // EFFECT WAY: `Ref.update` is itself an Effect, so "count, then send" is an ordinary pipeline that
        //   `Effect.retry` re-runs as a whole. The state change is explicit, typed, and fiber-safe.
        // DON'T: hoist the Ref outside the job: then the count would leak from one todo into the next.
        const attempts = yield* Ref.make(0)
        yield* Ref.update(attempts, (k) => k + 1).pipe(
          Effect.andThen(notifier.send(todo)),
          Effect.retry(notifyRetryPolicy),
          Effect.andThen(Ref.get(attempts)),
          Effect.andThen((attempt) => events.publish({ _tag: "NotificationSent", todoId: todo.id, attempt })),
          Effect.catch((e) =>
            Ref.get(attempts).pipe(
              Effect.andThen((attempt) =>
                Effect.logWarning(`worker ${n}: giving up on todo #${e.todoId} after ${attempt} attempts`)
              ),
            )
          ),
          Effect.withSpan("NotificationWorker.job", { attributes: { worker: n, todoId: todo.id } }),
        )
      }).pipe(Effect.forever)

    for (let n = 1; n <= WORKERS; n++) yield* Effect.forkScoped(worker(n))
  }),
)

// Periodic job. `Schedule.spaced(d)`: wait d AFTER each run finishes (never overlaps with itself).
// For "at 03:00 every night" use `Schedule.cron("0 3 * * *")` instead; same API, still testable with TestClock.
export const CleanupJob = Layer.effectDiscard(
  Effect.gen(function*() {
    const interval = yield* Config.Duration("TODO_CLEANUP_INTERVAL").pipe(Config.withDefault("2 minutes"))
    const repo = yield* TodoRepository
    const events = yield* TodoEvents

    const cleanupOnce = repo.deleteCompleted.pipe(
      Effect.tap((removed) => events.publish({ _tag: "CleanupRan", removed })),
      Effect.tap((removed) => Effect.logInfo(`🧹 cleanup removed ${removed} completed todo(s)`)),
      Effect.withSpan("CleanupJob.run"),
    )

    // Wait one interval, run, then repeat every interval. Careful where `repeat` goes: putting it around the
    // initial sleep too would wait 2x the interval between runs (the test in jobs.test.ts caught exactly that).
    yield* Effect.sleep(interval).pipe(
      Effect.andThen(cleanupOnce.pipe(Effect.repeat(Schedule.spaced(interval)))),
      Effect.forkScoped,
    )
  }),
)
