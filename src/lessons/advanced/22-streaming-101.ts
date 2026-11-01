// LESSON 22 (advanced): Streaming 101. Read docs/concepts/01-streaming.md first (or alongside).
//
// PROBLEM: some data does not exist "all at once": 1M rows, a log that never ends, live events.
//   An array (a bucket) must be full before you can use it. A stream (a pipe) hands you values as they arrive.
// EFFECT WAY: `Stream<A, E, R>` is a lazy, PULL-based, typed pipe. Nothing runs until you call a `Stream.run*`.
//   It can wrap the regular tools (async generators, ReadableStream, PubSub) so you learn ONE set of operators.
//
// Each section below shows one idea twice: the regular JS way first, then the same with `Stream`.
//   1. bucket vs pipe          4. chunks
//   2. pull vs push            5. lifecycle: end / error / cancel
//   3. cold vs hot
//
// DON'T: `Stream.runCollect` on endless data (it tries to fill a bucket that never fills). `Stream.take` first.
import { Effect, Fiber, Option, PubSub, Queue, Stream } from "effect"
import { EventEmitter } from "node:events"

const section = (title: string) => Effect.sync(() => console.log(`\n── ${title} ──`))
const log = (...args: Array<unknown>) => Effect.sync(() => console.log(...args))

// ── 1. Bucket vs pipe ────────────────────────────────────────────────────────
// Regular: an array is a bucket. It is built fully BEFORE the first value is used.
// A generator is a pipe: each value is made only when the consumer asks for it.
function* numbers() {
  for (let n = 1; ; n++) {
    console.log("   (generator makes", n, ")")
    yield n
  }
}

const bucketVsPipeRegular = () => {
  const bucket = [1, 2, 3, 4, 5].map((n) => n * 10) // all 5 exist right now
  console.log("bucket:", bucket)
  const pipe: Array<number> = []
  for (const n of numbers()) { // endless, but we only pull 3
    pipe.push(n * 10)
    if (pipe.length === 3) break
  }
  console.log("pipe:  ", pipe)
}

// Effect: the same pipe. `Stream.iterate` is endless; `take(3)` means only 3 are ever made.
const bucketVsPipeEffect = Stream.iterate(1, (n) => n + 1).pipe(
  Stream.tap((n) => log("   (stream makes", n, ")")),
  Stream.map((n) => n * 10),
  Stream.take(3),
  Stream.runCollect,
  Effect.flatMap((xs) => log("stream:", xs)),
)

// ── 2. Pull vs push ──────────────────────────────────────────────────────────
// PULL: the consumer says "next please" (async iterator, Effect Stream). A slow consumer simply asks less often.
// PUSH: the producer fires whenever it likes (EventEmitter, DOM events, WebSocket). A slow consumer must
//   buffer or drop, the producer will not wait.
async function* pulledFromServer() {
  for (const page of ["page-1", "page-2"]) {
    await new Promise((r) => setTimeout(r, 5))
    yield page // runs ONLY when the for-await loop asks for the next value
  }
}

const pullVsPushRegular = async () => {
  for await (const page of pulledFromServer()) console.log("pulled:", page)

  const emitter = new EventEmitter()
  emitter.on("click", (n) => console.log("pushed: click", n)) // we don't ask, we get told
  emitter.emit("click", 1)
  emitter.emit("click", 2)
}

// Effect: wrap BOTH styles into a Stream. Push sources get a buffer (a queue) between them and the puller.
const pullVsPushEffect = Effect.gen(function*() {
  yield* Stream.fromAsyncIterable(pulledFromServer(), (e) => new Error(String(e))).pipe(
    Stream.runForEach((page) => log("pulled:", page)),
  )

  const emitter = new EventEmitter()
  const clicks = Stream.callback<number>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const onClick = (n: number) => Queue.offerUnsafe(queue, n) // sync push into the buffer
        emitter.on("click", onClick)
        return onClick
      }),
      // Released when the stream stops: the listener is removed for us (no leaked emitter.on).
      (onClick) => Effect.sync(() => emitter.off("click", onClick)),
    )
  )
  const fiber = yield* clicks.pipe(Stream.take(2), Stream.runForEach((n) => log("pushed: click", n)), Effect.forkChild)
  yield* Effect.sleep("10 millis") // let the listener attach
  emitter.emit("click", 1)
  emitter.emit("click", 2)
  yield* Fiber.join(fiber)
  yield* log("listeners left after the stream ended:", emitter.listenerCount("click"))
})

// ── 3. Cold vs hot ───────────────────────────────────────────────────────────
// COLD: a recipe. Every consumer starts it from the beginning (each one hits the API again).
// HOT: already running. You join partway and only see what happens AFTER you joined (a radio, a live feed).
let apiCalls = 0
const fetchPage = (page: number) =>
  Effect.sync(() => {
    apiCalls++
    // [items on this page, next page or none]
    return [[`todo-${page}a`, `todo-${page}b`], page < 2 ? Option.some(page + 1) : Option.none()] as const
  })

const coldVsHotEffect = Effect.gen(function*() {
  // Cold: Stream.paginate is a description. Running it twice = calling the API twice.
  const allTodos = Stream.paginate(1, fetchPage)
  yield* Stream.runCollect(allTodos).pipe(Effect.flatMap((xs) => log("cold, consumer A:", xs)))
  yield* Stream.runCollect(allTodos).pipe(Effect.flatMap((xs) => log("cold, consumer B:", xs)))
  yield* log("api calls:", apiCalls, "(2 pages x 2 consumers)")

  // Hot: a PubSub is a live broadcast (this is how /api/v2/events works).
  const feed = yield* PubSub.unbounded<string>()
  yield* PubSub.publish(feed, "event-1 (nobody listening yet, lost)")
  const late = yield* Stream.fromPubSub(feed).pipe(Stream.take(2), Stream.runCollect, Effect.forkChild)
  yield* Effect.sleep("10 millis") // the late subscriber joins here
  yield* PubSub.publish(feed, "event-2")
  yield* PubSub.publish(feed, "event-3")
  yield* log("hot, late subscriber saw:", yield* Fiber.join(late))
})

// ── 4. Chunks ────────────────────────────────────────────────────────────────
// Handing over values one by one costs an await (a "hop") each. So streams move values in small BATCHES
// called chunks: 1 hop per chunk, not per value. You still write `map(n => ...)` per value.
// Regular: a ReadableStream of bytes also arrives in chunks (Uint8Array pieces) whose size you don't choose.
const chunksRegular = async () => {
  const body = new Response("hello streaming world").body!
  const reader = body.getReader()
  let hops = 0
  for (let r = await reader.read(); !r.done; r = await reader.read()) hops++
  console.log("ReadableStream: the whole text came in", hops, "chunk(s)")
}

const chunksEffect = Effect.gen(function*() {
  const tenThousand = Stream.range(1, 10_000)
  const chunkSizes = yield* tenThousand.pipe(Stream.chunks, Stream.map((c) => c.length), Stream.runCollect)
  yield* log("Stream.range(1, 10000) travels as", chunkSizes.length, "chunk(s) of sizes", chunkSizes)
  const rechunked = yield* tenThousand.pipe(Stream.rechunk(2500), Stream.chunks, Stream.runCount)
  yield* log("after rechunk(2500):", rechunked, "chunks")
  // And a regular ReadableStream can become a Stream too:
  const text = yield* Stream.fromReadableStream({
    evaluate: () => new Response("bytes from fetch()").body!,
    onError: (e) => new Error(String(e)),
  }).pipe(Stream.decodeText, Stream.mkString)
  yield* log("fromReadableStream + decodeText:", JSON.stringify(text))
})

// ── 5. Lifecycle: start -> values -> (end | error | cancel) ──────────────────
// Every stream ends in exactly one of three ways. Cleanup must run in ALL three.
// Regular: try/finally in a generator. `break` in for-await calls the generator's return(), so finally runs.
async function* withCleanup(label: string, failAt?: number) {
  try {
    for (let n = 1; n <= 3; n++) {
      if (n === failAt) throw new Error("boom")
      yield n
    }
  } finally {
    console.log(`   ${label}: cleanup ran`)
  }
}

const lifecycleRegular = async () => {
  for await (const n of withCleanup("end")) void n // ends normally
  try {
    for await (const n of withCleanup("error", 2)) void n
  } catch (e) {
    console.log("   error caught:", (e as Error).message)
  }
  for await (const n of withCleanup("cancel")) if (n === 1) break // the consumer leaves early (like a closed tab)
}

// Effect: `Stream.ensuring` runs on end, error AND interruption (cancel). `onExit` tells you which one happened
// (a cancel shows up as a Failure whose Cause is an interruption, not an error: see lesson 25 / concept 04).
const tracked = (label: string, s: Stream.Stream<number, string>) =>
  s.pipe(
    Stream.onExit((exit) => log(`   ${label}: exit was ${exit._tag}`)),
    Stream.ensuring(log(`   ${label}: cleanup ran`)),
  )

const lifecycleEffect = Effect.gen(function*() {
  yield* tracked("end", Stream.make(1, 2, 3)).pipe(Stream.runDrain)
  yield* tracked("error", Stream.concat(Stream.make(1), Stream.fail("boom"))).pipe(
    Stream.runDrain,
    Effect.catch((e) => log("   error caught:", e)),
  )
  // Cancel: an endless stream, interrupted from outside (what a client disconnect does in route.ts).
  const fiber = yield* tracked("cancel", Stream.tick("1 millis").pipe(Stream.as(0))).pipe(
    Stream.runDrain,
    Effect.forkChild,
  )
  yield* Effect.sleep("5 millis")
  yield* Fiber.interrupt(fiber)
})

export const main = Effect.gen(function*() {
  yield* section("1. bucket vs pipe: regular")
  yield* Effect.sync(bucketVsPipeRegular)
  yield* section("1. bucket vs pipe: Effect")
  yield* bucketVsPipeEffect

  yield* section("2. pull vs push: regular")
  yield* Effect.promise(pullVsPushRegular)
  yield* section("2. pull vs push: Effect")
  yield* pullVsPushEffect

  yield* section("3. cold vs hot: Effect")
  yield* coldVsHotEffect

  yield* section("4. chunks: regular")
  yield* Effect.promise(chunksRegular)
  yield* section("4. chunks: Effect")
  yield* chunksEffect

  yield* section("5. lifecycle: regular")
  yield* Effect.promise(lifecycleRegular)
  yield* section("5. lifecycle: Effect")
  yield* lifecycleEffect

  // YOUR TURN: in section 3, publish "event-1" AFTER the sleep. How many events does the late subscriber see now?
  // YOUR TURN: in section 2, emit 3 clicks but keep `take(2)`. Where does the third click go?
})
