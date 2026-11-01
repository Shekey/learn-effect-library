// LESSON 24 (advanced): The Stream toolbox.
//
// PROBLEM: lessons 15, 22 and 23 explained WHAT a stream is and WHY backpressure matters. Real code needs a
//   handful of operators over and over: batch these rows, rate-limit those calls, merge two feeds, retry a
//   flaky source, plug a callback API in, and clean up when someone hits "cancel".
// EFFECT WAY: each of those is ONE operator. This lesson shows every tool with a tiny demo that prints what
//   happens, then a "YOUR TURN" exercise. The mini feature that uses them for real lives in
//   src/features/csv-import (upload -> parse -> validate -> groupedWithin -> batch insert -> SSE progress).
//
// DON'T: reach for setInterval / manual arrays / `let buffer = []` + flush timers. Every one of those is an
//   operator below, and the operator also handles errors, interruption and backpressure.
import { type Duration, Effect, Fiber, PubSub, Queue, Schedule, Sink, Stream } from "effect"

const section = (title: string) => Effect.sync(() => console.log(`\n── ${title} ──`))
const log = (...args: Array<unknown>) => Effect.sync(() => console.log(...args))
const t0 = Date.now()
const ms = () => `${String(Date.now() - t0).padStart(5)}ms`

// ── The regular way: "100 rows or 1 second, whichever comes first" by hand ──────
// A buffer, a timer, a flush function, and a bug waiting to happen (forgot to clear the timer? flush twice?).
const regularWay = async () => {
  let buffer: Array<number> = []
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
    if (buffer.length) console.log("regular batch:", buffer)
    buffer = []
  }
  for (let i = 1; i <= 7; i++) {
    buffer.push(i)
    if (buffer.length === 3) flush()
    else timer ??= setTimeout(flush, 50)
    await new Promise((r) => setTimeout(r, i === 5 ? 80 : 5))
  }
  flush()
}

// ── 1. Chunk: what the stream is really passing around ──────────────────────────
// Internally a stream moves ARRAYS of items (chunks), not single items: much less overhead per element.
// `Stream.chunks` lets you see them. You rarely care, but it explains why `Stream.make(1,2,3)` is one pull.
const chunkDemo = Effect.gen(function*() {
  const chunks = yield* Stream.make(1, 2, 3).pipe(Stream.concat(Stream.make(4, 5)), Stream.chunks, Stream.runCollect)
  yield* log("chunks:", chunks) // [[1,2,3],[4,5]]
  const rechunked = yield* Stream.range(1, 5).pipe(Stream.rechunk(2), Stream.chunks, Stream.runCollect)
  yield* log("rechunk(2):", rechunked)
  // YOUR TURN: what does Stream.fromIterable([1,2,3,4]) look like through Stream.chunks?
})

// ── 2. Sink / Stream.run*: how a stream gets consumed ───────────────────────────
// A stream does nothing until something RUNS it. A Sink is a reusable "consumer" value.
const sinkDemo = Effect.gen(function*() {
  const numbers = Stream.range(1, 10)
  yield* log("Sink.sum:", yield* Stream.run(numbers, Sink.sum))
  yield* log("Sink.count:", yield* Stream.run(numbers, Sink.count))
  yield* log("Sink.take(3):", yield* Stream.run(numbers, Sink.take(3)))
  yield* log("runFold (product):", yield* Stream.runFold(numbers, () => 1, (acc, n) => acc * n))
  // YOUR TURN: use Sink.forEach to print every even number (filter first).
})

// ── 3. buffer + mapEffect({ concurrency }): overlap a slow producer and a slow consumer ──
const slowProducer = Stream.range(1, 4).pipe(Stream.mapEffect((n) => Effect.sleep("30 millis").pipe(Effect.as(n))))
const slowConsume = (n: number) => Effect.sleep("30 millis").pipe(Effect.as(n))
const bufferDemo = Effect.gen(function*() {
  const timed = <A>(label: string, s: Stream.Stream<A>) =>
    Effect.gen(function*() {
      const start = Date.now()
      yield* Stream.runDrain(s)
      yield* log(`${label}: ${Date.now() - start}ms`)
    })
  // Without a buffer: produce 1, consume 1, produce 2, ... (~240ms, they take turns)
  yield* timed("no buffer        ", slowProducer.pipe(Stream.mapEffect(slowConsume)))
  // With a buffer: the producer runs ahead while the consumer works (~150ms, they overlap)
  yield* timed("buffer(4)        ", slowProducer.pipe(Stream.buffer({ capacity: 4 }), Stream.mapEffect(slowConsume)))
  // Concurrency on the consumer side: up to 4 items consumed at once (order is kept!)
  yield* timed("mapEffect(conc 4)", slowProducer.pipe(Stream.buffer({ capacity: 4 }), Stream.mapEffect(slowConsume, { concurrency: 4 })))
  // YOUR TURN: try `strategy: "dropping"` with capacity 1. Which items survive? Why is that fine for metrics but not for orders?
})

// ── 4. groupedWithin(n, duration): "100 rows or 1 second, whichever comes first" ──
const groupedDemo = Stream.range(1, 7).pipe(
  // item 5 is followed by a long pause, so the time limit fires before the size limit
  Stream.mapEffect((n) => Effect.sleep(n === 6 ? "80 millis" : "5 millis").pipe(Effect.as(n))),
  Stream.groupedWithin(3, "50 millis"),
  Stream.runForEach((batch) => log(`${ms()} batch (one INSERT):`, batch)),
)
// YOUR TURN: change it to groupedWithin(100, "1 second"). How many batches now?

// ── 5. throttle / debounce: rate limits and search-as-you-type ──────────────────
const keystrokes = Stream.make("e", "ef", "eff", "effe", "effec", "effect").pipe(
  Stream.mapEffect((q, i) => Effect.sleep(i === 3 ? "60 millis" : "10 millis").pipe(Effect.as(q))),
)
const throttleDemo = Effect.gen(function*() {
  // debounce: only emit after 30ms of silence. Typing pauses after "eff", then finishes at "effect".
  yield* keystrokes.pipe(Stream.debounce("30 millis"), Stream.runForEach((q) => log(`${ms()} search for`, q)))
  // throttle "shape": at most 2 items per 50ms; extra items WAIT (backpressure). "enforce" would DROP them.
  // rechunk(1) first: throttle prices whole CHUNKS (section 1), and range(1, 6) is a single chunk of 6.
  yield* Stream.range(1, 6).pipe(
    Stream.rechunk(1),
    Stream.throttle({ cost: (arr) => arr.length, units: 2, duration: "50 millis", strategy: "shape" }),
    Stream.runForEach((n) => log(`${ms()} api call`, n)),
  )
  // YOUR TURN: switch strategy to "enforce". Which calls disappear?
})

// ── 6. merge / zip / broadcast: combine and split ───────────────────────────────
const every = (label: string, period: Duration.Input, n: number) =>
  Stream.fromSchedule(Schedule.spaced(period)).pipe(Stream.take(n), Stream.map((i) => `${label}${i}`))
const combineDemo = Effect.gen(function*() {
  // merge: whoever is ready first goes first (interleaved by time)
  yield* log("merge:", yield* Stream.runCollect(Stream.merge(every("a", "10 millis", 3), every("b", "25 millis", 2))))
  // zip: pairs them up, waits for BOTH sides (the slow one sets the pace)
  yield* log("zip:  ", yield* Stream.runCollect(Stream.zip(Stream.make(1, 2, 3), Stream.make("x", "y", "z"))))
  // broadcast: ONE source run, MANY consumers (e.g. write to DB AND update a progress counter)
  yield* Effect.scoped(Effect.gen(function*() {
    const shared = yield* Stream.broadcast(Stream.make(1, 2, 3), { capacity: 8, replay: 3 })
    const [sum, count] = yield* Effect.all([Stream.run(shared, Sink.sum), Stream.run(shared, Sink.count)], {
      concurrency: "unbounded",
    })
    yield* log("broadcast: sum =", sum, "count =", count)
  }))
  // YOUR TURN: zip every("a",...) with every("b",...). How long does it take compared to merge?
})

// ── 7. retry / schedule / timeout: resilient streams ────────────────────────────
const resilienceDemo = Effect.gen(function*() {
  let attempts = 0
  // A source that fails the first two times it is (re)started.
  const flaky = Stream.suspend(() => {
    attempts++
    return attempts < 3 ? Stream.fail(`connection lost (attempt ${attempts})`) : Stream.make("row1", "row2")
  })
  yield* log("retry:", yield* Stream.runCollect(flaky.pipe(Stream.retry(Schedule.recurs(5)))), "after", attempts, "attempts")
  // schedule: space the items out (a poll every 20ms)
  yield* Stream.make(1, 2, 3).pipe(
    Stream.schedule(Schedule.spaced("20 millis")),
    Stream.runForEach((n) => log(`${ms()} scheduled`, n)),
  )
  // timeout: end the stream if the next item takes too long
  const stalled = Stream.make(1, 2).pipe(Stream.concat(Stream.never))
  yield* log("timeout:", yield* Stream.runCollect(stalled.pipe(Stream.timeout("30 millis"))))
  // YOUR TURN: make `flaky` fail 10 times. What does runCollect return now? Wrap it in Effect.exit to see.
})

// ── 8. callback / fromPubSub: data from PUSH sources (event emitters, websockets, PubSub) ──
const pushDemo = Effect.gen(function*() {
  // Stream.callback hands you a Queue. Push into it from any callback-based API.
  const clicks = Stream.callback<string>((queue) =>
    Effect.gen(function*() {
      const id = setInterval(() => {
        // CAVEAT: offerUnsafe is synchronous and IGNORES backpressure. If the buffer is full it returns false
        // and (with the default "suspend" strategy) the item is LOST because a sync callback cannot wait.
        // For a fast source pick `bufferSize` + `strategy: "sliding" | "dropping"` on purpose, or use
        // `yield* Queue.offer(queue, x)` where you CAN wait (inside an Effect).
        Queue.offerUnsafe(queue, "click")
      }, 10)
      // Runs when the stream ends or is interrupted: the listener is always removed.
      yield* Effect.addFinalizer(() => Effect.sync(() => (clearInterval(id), console.log("listener removed"))))
    }), { bufferSize: 16 })
  yield* log("callback:", yield* Stream.runCollect(clicks.pipe(Stream.take(3))))

  // fromPubSub: every subscriber gets every message published AFTER it subscribed (see todos/domain/todoEvents.ts)
  const pubsub = yield* PubSub.bounded<string>({ capacity: 16, replay: 4 })
  yield* PubSub.publishAll(pubsub, ["created", "toggled", "deleted"])
  yield* log("fromPubSub (replay):", yield* Stream.runCollect(Stream.fromPubSub(pubsub).pipe(Stream.take(3))))
  // YOUR TURN: set bufferSize: 1, strategy: "sliding" and take(3) after a 50ms delay. Which clicks do you get?
})

// ── 9. Resource safety: acquireRelease + interruption ───────────────────────────
const resourceDemo = Effect.gen(function*() {
  const file = Stream.scoped(
    Stream.fromEffect(Effect.acquireRelease(
      log("open file").pipe(Effect.as("handle")),
      () => log("close file  <- runs on success, failure AND interruption"),
    )),
  ).pipe(Stream.flatMap(() => Stream.fromSchedule(Schedule.spaced("10 millis"))))

  // Start reading forever, then cancel (like a browser tab closing mid-upload).
  const fiber = yield* file.pipe(Stream.runForEach((n) => log("read line", n)), Effect.forkChild)
  yield* Effect.sleep("35 millis")
  yield* Fiber.interrupt(fiber)
  yield* log("interrupted: the running stream stopped and its finalizer ran")
  // YOUR TURN: replace Fiber.interrupt with Stream.take(2). Does "close file" still print?
})

export const main = Effect.gen(function*() {
  yield* section("regular way: hand-rolled batching")
  yield* Effect.promise(regularWay)
  yield* section("1. Chunk")
  yield* chunkDemo
  yield* section("2. Sink / Stream.run*")
  yield* sinkDemo
  yield* section("3. buffer + mapEffect concurrency")
  yield* bufferDemo
  yield* section("4. groupedWithin")
  yield* groupedDemo
  yield* section("5. debounce / throttle")
  yield* throttleDemo
  yield* section("6. merge / zip / broadcast")
  yield* combineDemo
  yield* section("7. retry / schedule / timeout")
  yield* resilienceDemo
  yield* section("8. callback / fromPubSub")
  yield* pushDemo
  yield* section("9. acquireRelease + interruption")
  yield* resourceDemo
  yield* log("\nNext: see it all in a real feature -> src/features/csv-import, page /csv-import")
})
