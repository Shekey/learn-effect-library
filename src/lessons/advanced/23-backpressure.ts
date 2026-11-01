// LESSON 23 (advanced): backpressure. What to do when the producer is faster than the consumer.
// Concept doc (read first): docs/concepts/02-backpressure.md
//
// PROBLEM (regular way): the cook makes a plate every 50ms, the waiter carries one every 200ms.
//   With a plain array as the "counter", plates pile up forever: memory grows, the last plate waits
//   longer and longer (latency grows), and when the process crashes every plate on the counter is lost.
// EFFECT WAY: give the counter a SIZE and pick what happens when it is full:
//   Queue.bounded(n)   producer WAITS until there is room              (backpressure: nothing lost)
//   Stream.buffer      a bounded counter between two stream stages     (absorbs short bursts)
//   Queue.sliding(n)   accept the new plate, throw away the OLDEST     (latest price, latest position)
//   Queue.dropping(n)  keep what is there, throw away the NEW plate    (metrics sampling)
// DON'T: use an unbounded queue / array for input you don't control. "Unbounded" means "until OOM".
import { Effect, Fiber, Option, Queue, Stream } from "effect"

const section = (title: string) => Effect.sync(() => console.log(`\n── ${title} ──`))
const PLATES = 8
const COOK_MS = 50
const WAITER_MS = 200

const clock = () => {
  const t0 = Date.now()
  return (msg: string) => Effect.sync(() => console.log(`${String(Date.now() - t0).padStart(5)}ms  ${msg}`))
}

// ── The regular way ──────────────────────────────────────────────────────────
const regularWay = async () => {
  const counter: Array<number> = []
  const t0 = Date.now()
  const cook = setInterval(() => counter.push(counter.length), COOK_MS)
  await new Promise((r) => setTimeout(r, 1000))
  clearInterval(cook)
  console.log(`after ${Date.now() - t0}ms the counter holds ${counter.length} plates and keeps growing.`)
  console.log("nobody told the cook to slow down; in production this is a memory leak with extra latency.")
}

// ── The Effect way ───────────────────────────────────────────────────────────

// One experiment, run once per queue strategy. The cook offers PLATES plates (one every COOK_MS);
// the waiter takes one every WAITER_MS. We log the queue size and how long each offer had to wait.
const kitchen = (name: string, makeQueue: Effect.Effect<Queue.Queue<number>>) =>
  Effect.gen(function*() {
    yield* section(name)
    const log = clock()
    const queue = yield* makeQueue
    const served: Array<number> = []

    const waiter = yield* Effect.gen(function*() {
      yield* Effect.sleep(`${WAITER_MS} millis`)
      const plate = yield* Queue.take(queue)
      served.push(plate)
      yield* log(`                    waiter served plate ${plate}  (size now ${yield* Queue.size(queue)})`)
    }).pipe(Effect.forever, Effect.forkChild)

    for (let plate = 1; plate <= PLATES; plate++) {
      const before = Date.now()
      yield* Queue.offer(queue, plate)
      const waited = Date.now() - before
      yield* log(`cook offered ${plate}  size=${yield* Queue.size(queue)}${waited > 5 ? `  WAITED ${waited}ms` : ""}`)
      yield* Effect.sleep(`${COOK_MS} millis`)
    }
    // let the waiter empty the counter, then send him home
    yield* Effect.sleep(`${WAITER_MS * 3 + 50} millis`)
    yield* Fiber.interrupt(waiter)
    yield* log(`served ${JSON.stringify(served)}  -> lost ${PLATES - served.length} plate(s)`)
  })

// Strategy 2 in stream form: a fast source, a slow sink, and a bounded buffer in between.
// Without .buffer the source is pulled one element at a time (it waits on every step).
// With .buffer({ capacity: 3 }) the source may run ahead (the 3 buffered + the ones already in flight
// between stages), then it WAITS: in the output, "source produced 8" only appears once the sink catches up.
const streamBuffer = Effect.gen(function*() {
  yield* section("2. Stream.buffer({ capacity: 3 }): absorb a burst, then backpressure")
  const log = clock()
  yield* Stream.range(1, 8).pipe(
    Stream.tap((n) => log(`source produced ${n}`)),
    Stream.buffer({ capacity: 3 }),
    Stream.tap((n) => log(`                    sink handled ${n}`).pipe(Effect.andThen(Effect.sleep("150 millis")))),
    Stream.runDrain,
  )
})

// Pull-based = backpressure for free: paginate only asks for page N+1 once page N was consumed.
const pullBased = Effect.gen(function*() {
  yield* section("bonus: Stream.paginate is pull-based, take(4) fetches only 2 of 100 pages")
  const items = yield* Stream.paginate(1, (page: number) =>
    Effect.sync(() => {
      console.log(`  fetching page ${page}`)
      return [[`${page}a`, `${page}b`], page < 100 ? Option.some(page + 1) : Option.none()] as const
    })).pipe(Stream.take(4), Stream.runCollect)
  console.log(`  got ${JSON.stringify(items)}`)
})

export const main = Effect.gen(function*() {
  yield* section("regular way: an array as the counter")
  yield* Effect.promise(regularWay)
  yield* kitchen("1. Queue.bounded(2): the cook WAITS (nothing lost, cook slowed down)", Queue.bounded<number>(2))
  yield* streamBuffer
  yield* kitchen("3. Queue.sliding(2): cook never waits, the OLDEST plates are dropped", Queue.sliding<number>(2))
  yield* kitchen("4. Queue.dropping(2): cook never waits, the NEW plates are dropped", Queue.dropping<number>(2))
  yield* pullBased

  // YOUR TURN:
  //  - make the waiter faster than the cook (WAITER_MS = 20): all 4 strategies now behave the same.
  //  - change Queue.bounded(2) to Queue.bounded(8): the cook never waits, the queue just holds everything.
  //  - remove Stream.buffer: the source now produces exactly one element per sink step.
}).pipe(Effect.scoped)
