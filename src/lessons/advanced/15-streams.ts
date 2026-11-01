// LESSON 15 (advanced): Streams.
//
// PROBLEM: process lots of (or endless) data without holding it all in memory.
// EFFECT WAY: a Stream is lazy and pull-based: items are produced only as fast as the consumer asks
//   (backpressure). It is typed (`Stream<A, E, R>`), can be interrupted, and composes like arrays.
//
// The real use in this app: effect/application/streamEvents.ts -> api/effect/events-stream/route.ts
// (a Stream turned into a ReadableStream response, cancelled when the client disconnects).
//
// DON'T: `Stream.runCollect` on unbounded data. Bound it first with `Stream.take`, or use `Stream.runForEach`.
import { Effect, Stream } from "effect"

const section = (title: string) => Effect.sync(() => console.log(`\n── ${title} ──`))
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// ── The regular way ──────────────────────────────────────────────────────────
// Async generators are lazy too, but every operator (map, filter, take) is a hand-written loop,
// and there are no typed errors, no retry, no concurrency control.
async function* range(from: number, to: number) {
  for (let n = from; n <= to; n++) yield n
}

const regularWay = async () => {
  const firstThree: Array<number> = []
  for await (const n of range(1, 1_000_000_000)) {
    firstThree.push(n * n)
    if (firstThree.length === 3) break
  }
  console.log("1. first three squares:", firstThree)

  for await (const n of range(1, 6)) {
    if (n % 2 !== 0) continue
    await sleep(5)
    console.log("2. got", n * 10)
  }
}

// ── The Effect way ───────────────────────────────────────────────────────────
const effectWay = Effect.gen(function*() {
  // A billion items, never materialized: only 3 are ever computed.
  const firstThree = yield* Stream.range(1, 1_000_000_000).pipe(
    Stream.map((n) => n * n),
    Stream.take(3),
    Stream.runCollect,
  )
  console.log("1. first three squares:", firstThree)

  // Filter, then run an effect per item (could be an HTTP call, with retry/timeout from lesson 10).
  yield* Stream.make(1, 2, 3, 4, 5, 6).pipe(
    Stream.filter((n) => n % 2 === 0),
    Stream.mapEffect((n) => Effect.sleep("5 millis").pipe(Effect.as(n * 10))),
    Stream.runForEach((n) => Effect.sync(() => console.log("2. got", n))),
  )
})

export const main = Effect.gen(function*() {
  yield* section("regular way (async generator)")
  yield* Effect.promise(regularWay)

  yield* section("Effect way (Stream)")
  yield* effectWay

  // YOUR TURN: add `{ concurrency: 3 }` as the second argument of Stream.mapEffect. Does the order change?
})
