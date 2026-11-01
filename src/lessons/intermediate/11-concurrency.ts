// LESSON 11 (intermediate): Concurrency: all, forEach, race, interruption (semaphores: lesson 12)
//
// CONCEPTS FIRST: docs/concepts/03-concurrency.md (event loop, fibers, structured concurrency, Scope)
//
// PROBLEM: Promise.all keeps the other promises running when one fails; Promise.race can't cancel the loser;
//   nothing limits how many run at once.
// EFFECT WAY: effects run on lightweight FIBERS that form a tree. If one child fails (in `all`) or loses
//   (in `race`), the others are interrupted automatically ("structured concurrency").
//
//   Effect.all([a, b], {concurrency})       fixed set, results by position
//   Effect.forEach(items, f, {concurrency}) one effect per item, with a limit
//   Effect.race(a, b)                       first SUCCESS wins, loser interrupted
//
// WHEN to limit: always, when items come from user input or a DB (`concurrency: 5`, not "unbounded").
// DON'T: `Promise.all(items.map(...))` on thousands of items.
import { Effect } from "effect"

const section = (title: string) => Effect.sync(() => console.log(`\n── ${title} ──`))
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// ── The regular way ──────────────────────────────────────────────────────────
const regularWork = async (name: string, ms: number) => {
  await sleep(ms)
  console.log(`  ${name} finished (nobody stopped it)`)
  return name
}

const regularWay = async () => {
  // 1) Limiting concurrency by hand: process in chunks of 2 (a slow chunk blocks the next one).
  const items = [1, 2, 3, 4, 5, 6]
  for (let i = 0; i < items.length; i += 2) {
    await Promise.all(items.slice(i, i + 2).map(() => sleep(20)))
  }
  console.log("1. processed in chunks of 2")

  // 2) race: we get the winner, but the slow loser keeps running.
  console.log("2. race winner:", await Promise.race([regularWork("fast", 20), regularWork("slow", 100)]))

  // 3) all: one fails, the other keeps running anyway.
  const failed = await Promise.all([regularWork("long job", 100), Promise.reject(new Error("boom"))]).catch(() => "failed")
  console.log("3. all ->", failed)
  await sleep(150) // let the leftovers print before the Effect section
}

// ── The Effect way ───────────────────────────────────────────────────────────
const work = (name: string, ms: number) =>
  Effect.sleep(ms).pipe(
    Effect.as(name),
    Effect.onInterrupt(() => Effect.sync(() => console.log(`  ${name} interrupted`))),
  )

const effectWay = Effect.gen(function*() {
  // 1) A real limit: always 2 running, the next one starts as soon as one finishes.
  let inFlight = 0
  let maxInFlight = 0
  const track = Effect.fn(function*(n: number) {
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    yield* Effect.sleep("20 millis")
    inFlight--
    return n
  })
  yield* Effect.forEach([1, 2, 3, 4, 5, 6], track, { concurrency: 2 })
  console.log("1. max in flight with concurrency 2:", maxInFlight)

  // 2) race: the fastest wins, the slow one is cancelled for real.
  console.log("2. race winner:", yield* Effect.race(work("fast", 20), work("slow", 500)))

  // 3) all: one fails, the sibling is interrupted.
  const exit = yield* Effect.exit(Effect.all([work("long job", 500), Effect.fail("boom")], { concurrency: 2 }))
  console.log("3. all ->", exit._tag)
})

export const main = Effect.gen(function*() {
  yield* section("regular way (Promise.all / Promise.race)")
  yield* Effect.promise(regularWay)

  yield* section("Effect way (forEach / race / all)")
  yield* effectWay

  // YOUR TURN: change `concurrency: 2` to `concurrency: "unbounded"` and look at the max in flight.
})
