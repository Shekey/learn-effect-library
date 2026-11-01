// LESSON 20 (advanced): background work. Queue (share work), PubSub (broadcast), Schedule (repeat).
//
// PROBLEM (regular way): an array as a queue, an EventEmitter for events, setInterval for periodic jobs.
//   - the array grows without limit when producers are faster than consumers
//   - a throwing listener breaks the emitter; who removes listeners on shutdown?
//   - setInterval keeps running after the thing that started it is gone (hot reload, tests)
// EFFECT WAY:
//   Queue.bounded(n)   when full, `offer` WAITS: the producer slows to the consumer's pace (backpressure)
//   PubSub             every subscriber gets every message (fan-out); each one runs on its own fiber
//   Schedule           "every 300ms", "exponential backoff", "cron 0 3 * * *" as VALUES you can test (lesson 21)
//   forkScoped         background fibers tied to a Scope: close the scope -> they are all interrupted
// The app version of this lives in src/features/todos/jobs/todoJobs.ts (open /todos to watch it).
import { Effect, Fiber, PubSub, Queue, Schedule, Stream } from "effect"

const section = (title: string) => Effect.sync(() => console.log(`\n── ${title} ──`))
const t0 = Date.now()
const log = (msg: string) => Effect.sync(() => console.log(`${String(Date.now() - t0).padStart(5)}ms  ${msg}`))

// ── The regular way ──────────────────────────────────────────────────────────
const regularWay = async () => {
  const queue: number[] = []
  for (let i = 1; i <= 1000; i++) queue.push(i) // nothing stops this; with real input it's a memory leak
  console.log(`queued ${queue.length} jobs instantly; consumers are nowhere near done. Memory is the limit.`)
  const timer = setInterval(() => console.log("tick (who will clearInterval me?)"), 100)
  await new Promise((r) => setTimeout(r, 250))
  clearInterval(timer) // forget this line and the process never exits
}

// ── The Effect way ───────────────────────────────────────────────────────────

// 1. Backpressure: a queue of 2, one slow worker. Watch the producer WAIT at "offering 4".
const backpressure = Effect.gen(function*() {
  const queue = yield* Queue.bounded<number>(2)
  yield* Effect.forkScoped(
    Effect.gen(function*() {
      const job = yield* Queue.take(queue)
      yield* log(`  worker   took job ${job}`)
      yield* Effect.sleep("300 millis")
    }).pipe(Effect.forever),
  )
  for (let i = 1; i <= 5; i++) {
    const before = Date.now()
    yield* Queue.offer(queue, i) // suspends while the queue is full
    const waited = Date.now() - before
    yield* log(`producer queued ${i}${waited > 50 ? `  <- WAITED ${waited}ms: queue was full (backpressure)` : ""}`)
  }
  yield* Effect.sleep("700 millis")
}).pipe(Effect.scoped) // scope closes -> the worker fiber is interrupted. No leak.

// 2. Fan-out: two subscribers each see every event, at their own speed.
const fanOut = Effect.gen(function*() {
  const pubsub = yield* PubSub.bounded<string>(16)
  const subscriber = (name: string, delay: "10 millis" | "150 millis") =>
    Stream.fromPubSub(pubsub).pipe(
      Stream.take(3),
      Stream.runForEach((e) => Effect.sleep(delay).pipe(Effect.andThen(log(`  ${name} got ${e}`)))),
    )
  const audit = yield* Effect.forkScoped(subscriber("audit   ", "10 millis"))
  const mailer = yield* Effect.forkScoped(subscriber("mailer  ", "150 millis"))
  yield* Effect.yieldNow // let both subscribe before publishing
  for (const e of ["created #1", "created #2", "created #3"]) yield* PubSub.publish(pubsub, e)
  yield* log("publisher done (did not wait for the slow mailer)")
  yield* Fiber.joinAll([audit, mailer])
}).pipe(Effect.scoped)

// 3. Schedules are values. Run now, then every 200ms, stopping once 700ms have passed.
const periodic = log("  cleanup job ran").pipe(
  Effect.repeat(Schedule.spaced("200 millis").pipe(Schedule.upTo({ duration: "700 millis" }))),
)

export const main = Effect.gen(function*() {
  yield* section("regular way (array queue + setInterval)")
  yield* Effect.promise(regularWay)

  yield* section("Effect way 1: Queue.bounded(2) -> backpressure")
  yield* backpressure

  yield* section("Effect way 2: PubSub -> every subscriber gets every event")
  yield* fanOut

  yield* section("Effect way 3: Schedule.spaced(200ms) for ~700ms")
  yield* periodic

  // YOUR TURN:
  //  - change Queue.bounded(2) to Queue.bounded(10): the producer never waits.
  //  - change PubSub to a Queue in fanOut: now each event goes to ONE subscriber (work sharing).
  //  - in the app: add 5 todos quickly on /todos and watch the 2 workers share them in the live feed.
})
