// Background jobs under VIRTUAL time. `TestClock.adjust("2 minutes")` moves the clock instantly, and every
// sleep / retry backoff / schedule that would have fired in that window fires now. This file runs in
// milliseconds, though it covers retries with exponential backoff and a job that runs every 2 minutes.
import { Effect, Layer, Ref, Stream } from "effect"
import { TestClock } from "effect/testing"
import { describe, expect, it } from "vitest"
import type { Todo } from "../domain/todo"
import { TodoEvents, type TodoEvent } from "../domain/todoEvents"
import { TodoRepository } from "../domain/todoRepository"
import { TodoRepositoryMemory } from "../infrastructure/todoRepositoryMemory"
import { Notifier, NotifyFailed } from "../jobs/notifier"
import { CleanupJob, NotificationWorkers } from "../jobs/todoJobs"

// A deterministic Notifier: fails the first `failures` calls per todo, each call takes 400ms (virtual).
const scriptedNotifier = (failures: number, sent: Array<number>) => {
  const attempts = new Map<number, number>()
  return Layer.succeed(Notifier, Notifier.of({
    send: (todo: Todo) =>
      Effect.gen(function*() {
        yield* Effect.sleep("400 millis")
        const n = (attempts.get(todo.id) ?? 0) + 1
        attempts.set(todo.id, n)
        if (n <= failures) return yield* new NotifyFailed({ todoId: todo.id })
        sent.push(todo.id)
      }),
  }))
}

// Builds the jobs on top of fresh core services, then runs `test` with TestClock in charge of time.
const runJobs = <A, E>(notifier: Layer.Layer<Notifier>, test: Effect.Effect<A, E, TodoRepository | TodoEvents>) =>
  Effect.runPromise(
    test.pipe(
      Effect.provide(
        Layer.mergeAll(NotificationWorkers, CleanupJob).pipe(
          Layer.provide(notifier),
          Layer.provideMerge(Layer.mergeAll(TodoRepositoryMemory, TodoEvents.layer)),
        ),
      ),
      Effect.provide(TestClock.layer()),
    ),
  )

// Collects every event published while the test runs.
const recordEvents = Effect.gen(function*() {
  const events = yield* TodoEvents
  const seen = yield* Ref.make<ReadonlyArray<TodoEvent>>([])
  yield* events.subscribe.pipe(Stream.runForEach((e) => Ref.update(seen, (xs) => [...xs, e])), Effect.forkScoped)
  yield* Effect.yieldNow
  return seen
})

describe("notification workers (Queue + retry)", () => {
  it("retries a flaky notifier with backoff and reports the attempt count", () => {
    const sent: Array<number> = []
    return runJobs(scriptedNotifier(2, sent), Effect.scoped(Effect.gen(function*() {
      const seen = yield* recordEvents
      const repo = yield* TodoRepository
      const events = yield* TodoEvents
      const todo = yield* repo.create({ title: "notify me" })
      yield* events.publish({ _tag: "TodoCreated", todo })

      // attempt 1 (400ms) fails, wait 200ms, attempt 2 (400ms) fails, wait 400ms, attempt 3 (400ms) succeeds.
      yield* TestClock.adjust("1 second")
      expect(sent).toEqual([]) // not yet: total is 1.8s of virtual time
      yield* TestClock.adjust("1 second")
      expect(sent).toEqual([todo.id])
      expect((yield* Ref.get(seen)).find((e) => e._tag === "NotificationSent")).toMatchObject({ attempt: 3 })
    })))
  })

  it("two workers process two jobs in parallel (400ms total, not 800ms)", () => {
    const sent: Array<number> = []
    return runJobs(scriptedNotifier(0, sent), Effect.scoped(Effect.gen(function*() {
      const repo = yield* TodoRepository
      const events = yield* TodoEvents
      for (const title of ["a", "b"]) yield* events.publish({ _tag: "TodoCreated", todo: yield* repo.create({ title }) })
      yield* TestClock.adjust("400 millis")
      expect(sent).toHaveLength(2)
    })))
  })
})

describe("cleanup job (Schedule.spaced)", () => {
  it("deletes completed todos every 2 minutes, without waiting 2 real minutes", () =>
    runJobs(scriptedNotifier(0, []), Effect.scoped(Effect.gen(function*() {
      const seen = yield* recordEvents
      const repo = yield* TodoRepository
      const done = yield* repo.create({ title: "done already" })
      yield* repo.toggle(done.id)

      yield* TestClock.adjust("119 seconds")
      expect((yield* repo.list).map((t) => t.id)).toContain(done.id) // not yet

      yield* TestClock.adjust("1 second") // t = 2 minutes
      expect((yield* repo.list).map((t) => t.id)).not.toContain(done.id)

      yield* TestClock.adjust("2 minutes") // runs again
      const runs = (yield* Ref.get(seen)).filter((e) => e._tag === "CleanupRan")
      expect(runs).toHaveLength(2)
    }))))
})
