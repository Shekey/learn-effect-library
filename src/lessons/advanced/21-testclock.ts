// LESSON 21 (advanced): TestClock. Test time-based code (retries, timeouts, schedules) in milliseconds.
//
// PROBLEM: "retry 3 times with exponential backoff" and "runs every night at 03:00" are hard to test.
//   Real sleeps make tests slow and flaky; jest/vitest fake timers patch globals, don't know about promises
//   resolving between timers, and leak between tests.
// EFFECT WAY: all time in Effect goes through the Clock SERVICE (sleep, timeout, retry, Schedule, cron).
//   In tests, provide TestClock: time stands still until you call `TestClock.adjust(duration)`, which runs
//   everything that was due in that window, in order. Fork the code under test, adjust, then assert.
// DON'T: use `setTimeout`/`Date.now()` inside Effect code. Use Effect.sleep / Clock, or TestClock can't see it.
// Real tests using this: src/features/todos/__tests__/jobs.test.ts and user-profile/__tests__/infrastructure.test.ts
import { Effect, Fiber, Schedule } from "effect"
import { TestClock } from "effect/testing"

const section = (title: string) => Effect.sync(() => console.log(`\n── ${title} ──`))

// The code under test: retry with exponential backoff 1s, 2s, 4s (7 seconds of waiting in total).
let attempts = 0
const flaky = Effect.suspend(() => (++attempts < 4 ? Effect.fail("boom") : Effect.succeed("ok")))
const withRetry = flaky.pipe(Effect.retry({ schedule: Schedule.exponential("1 second"), times: 3 }))

// ── The regular way ──────────────────────────────────────────────────────────
// Really wait. (Scaled down 10x here so the lesson doesn't take 7 seconds; a real test would wait 7s.)
const regularWay = async () => {
  const started = Date.now()
  let tries = 0
  for (let delay = 100; ; delay *= 2) {
    if (++tries >= 4) break
    await new Promise((r) => setTimeout(r, delay))
  }
  console.log(`regular test took ${Date.now() - started}ms of real time (and 7000ms unscaled)`)
}

// ── The Effect way ───────────────────────────────────────────────────────────
const retryTest = Effect.gen(function*() {
  attempts = 0
  const fiber = yield* Effect.forkChild(withRetry) // 1. start it; it's now sleeping in virtual time
  yield* TestClock.adjust("2 seconds") //              2. move time: retries at 1s happened, the 2s one hasn't fired yet
  console.log(`after 2s virtual: ${attempts} attempts`)
  yield* TestClock.adjust("5 seconds") //              3. the rest (2s + 4s backoff, ending at 7s)
  console.log(`after 7s virtual: ${attempts} attempts, result: ${yield* Fiber.join(fiber)}`)
})

// A cron job: "at 03:00 every day". Two virtual days pass in an instant.
const cronTest = Effect.gen(function*() {
  let runs = 0
  const nightly = Effect.sync(() => runs++).pipe(Effect.repeat(Schedule.cron("0 3 * * *")))
  yield* Effect.forkChild(nightly)
  yield* TestClock.adjust("2 days")
  console.log(`nightly job ran ${runs} times in 2 virtual days (1 initial run + 2 at 03:00)`)
})

// A timeout: does the call give up after 5s? Without waiting 5s.
const timeoutTest = Effect.gen(function*() {
  const fiber = yield* Effect.forkChild(Effect.never.pipe(Effect.timeout("5 seconds"), Effect.flip))
  yield* TestClock.adjust("5 seconds")
  console.log("timed out with:", (yield* Fiber.join(fiber))._tag)
})

export const main = Effect.gen(function*() {
  yield* section("regular way (real waiting)")
  yield* Effect.promise(regularWay)

  yield* section("Effect way (TestClock: 7s of retries, 2 days of cron, a 5s timeout)")
  const started = Date.now()
  yield* Effect.all([retryTest, cronTest, timeoutTest], { discard: true }).pipe(
    // TestClock.layer() replaces the Clock for THIS effect only. `pnpm test` does the same per test.
    Effect.provide(TestClock.layer()),
  )
  console.log(`all three took ${Date.now() - started}ms of real time`)

  // YOUR TURN: open src/features/todos/__tests__/jobs.test.ts. Change "119 seconds" to "120 seconds" and
  // watch the "not yet" assertion fail: the cleanup job runs at exactly 2 minutes.
})
