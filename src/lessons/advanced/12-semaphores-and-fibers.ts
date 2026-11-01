// LESSON 12 (advanced): Fibers and Semaphores.
//
// CONCEPTS FIRST: docs/concepts/03-concurrency.md (event loop, fibers, structured concurrency, Scope)
//
// A FIBER is a lightweight thread of Effect work. `Effect.forkChild` starts one in the background and gives you
// a handle; `Fiber.join` waits for it, `Fiber.interrupt` cancels it. Fibers form a tree: if the parent ends,
// its children are interrupted. No orphaned background work.
//
// A SEMAPHORE is a box of N permits. To enter a section you take permits; when you leave they go back.
//   Semaphore.make(1)        a lock (mutex): one at a time
//   Semaphore.make(2 or 3)   at most 2 or 3 at a time (e.g. an API that allows 3 parallel calls)
//   withPermits(2)           a heavy task can take more than one permit
// `concurrency: N` (lesson 11) limits one batch; a Semaphore limits a shared resource across the whole program,
// even for callers that know nothing about each other.
//
// WHEN: rate-limited APIs, a small DB pool, "only one refresh at a time".
// DON'T: share mutable variables between fibers without a Ref or a Semaphore.
import { Effect, Fiber, Semaphore } from "effect"

const section = (title: string) => Effect.sync(() => console.log(`\n── ${title} ──`))
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// ── The regular way ──────────────────────────────────────────────────────────
// A hand-written limiter: a counter + a queue of waiting callers. Easy to get subtly wrong
// (forgetting `release` on an exception, no cancellation, no weighted permits).
const makeRegularLimiter = (permits: number) => {
  let available = permits
  const waiting: Array<() => void> = []
  const acquire = () =>
    new Promise<void>((resolve) => {
      if (available > 0) {
        available--
        resolve()
      } else waiting.push(resolve)
    })
  const release = () => {
    const next = waiting.shift()
    if (next) next()
    else available++
  }
  return async <A>(task: () => Promise<A>) => {
    await acquire()
    try {
      return await task()
    } finally {
      release() // forget this `finally` and the limiter deadlocks after the first error
    }
  }
}

const regularWay = async () => {
  const limit = makeRegularLimiter(2)
  let inside = 0
  let maxInside = 0
  await Promise.all(
    [1, 2, 3, 4, 5, 6].map((n) =>
      limit(async () => {
        maxInside = Math.max(maxInside, ++inside)
        await sleep(20)
        inside--
        return n
      })
    ),
  )
  console.log("max inside with a hand-written limiter of 2:", maxInside)
}

// ── The Effect way ───────────────────────────────────────────────────────────
// Helper: a task that prints when it enters and leaves, and how many permits are in use.
const makeTracker = () => {
  let used = 0
  let maxUsed = 0
  const task = (name: string, permits: number, ms: number) =>
    Effect.gen(function*() {
      used += permits
      maxUsed = Math.max(maxUsed, used)
      console.log(`  ${name.padEnd(8)} enters (permits in use: ${used})`)
      yield* Effect.sleep(ms)
      used -= permits
      console.log(`  ${name.padEnd(8)} leaves`)
    })
  return { task, maxUsed: () => maxUsed }
}

// 1) fork + join + interrupt
const fibers = Effect.gen(function*() {
  const background = yield* Effect.forkChild(Effect.sleep("30 millis").pipe(Effect.as("background result")))
  console.log("doing other work while the fiber runs...")
  console.log("joined:", yield* Fiber.join(background))

  const slow = yield* Effect.forkChild(
    Effect.sleep("5 seconds").pipe(Effect.onInterrupt(() => Effect.sync(() => console.log("slow fiber cleaned up")))),
  )
  yield* Effect.sleep("10 millis")
  yield* Fiber.interrupt(slow)
})

// 2) A lock: Semaphore with 1 permit
const lockExample = Effect.gen(function*() {
  const lock = yield* Semaphore.make(1)
  const tracker = makeTracker()
  const critical = (name: string) => lock.withPermits(1)(tracker.task(name, 1, 10))
  yield* Effect.all([critical("A"), critical("B"), critical("C")], { concurrency: "unbounded" })
  console.log("max permits in use:", tracker.maxUsed(), "(one at a time)")
})

// 3) At most 2 at a time: 6 callers, never more than 2 inside
const twoPermitsExample = Effect.gen(function*() {
  const apiSlots = yield* Semaphore.make(2)
  const tracker = makeTracker()
  const callApi = (name: string) => apiSlots.withPermits(1)(tracker.task(name, 1, 20))
  yield* Effect.all(["call-1", "call-2", "call-3", "call-4", "call-5", "call-6"].map(callApi), {
    concurrency: "unbounded",
  })
  console.log("max permits in use:", tracker.maxUsed(), "(never more than 2)")
})

// 4) Weighted: 3 permits. A heavy job takes 2 permits, light jobs take 1.
//    While the heavy job runs only one light job fits; afterwards up to three light jobs run together.
const weightedExample = Effect.gen(function*() {
  const capacity = yield* Semaphore.make(3)
  const tracker = makeTracker()
  const heavy = (name: string) => capacity.withPermits(2)(tracker.task(name, 2, 40))
  const light = (name: string) => capacity.withPermits(1)(tracker.task(name, 1, 20))
  yield* Effect.all([heavy("heavy"), light("light-1"), light("light-2"), light("light-3"), light("light-4")], {
    concurrency: "unbounded",
  })
  console.log("max permits in use:", tracker.maxUsed(), "(never more than 3)")
})

export const main = Effect.gen(function*() {
  yield* section("regular way (hand-written limiter of 2)")
  yield* Effect.promise(regularWay)

  yield* section("1. fibers: fork, join, interrupt")
  yield* fibers

  yield* section("2. Semaphore(1): a lock")
  yield* lockExample

  yield* section("3. Semaphore(2): at most two API calls at once")
  yield* twoPermitsExample

  yield* section("4. Semaphore(3) with weighted permits")
  yield* weightedExample

  // YOUR TURN: in example 3 change Semaphore.make(2) to 3. How does the enter/leave pattern change?
})
