// LESSON 10 (intermediate): Retry, timeout, schedules (resilience as building blocks)
// (New to this? Start with lesson 6.)
//
// PROBLEM: networks fail transiently. Hand-written retry loops forget: backoff, max attempts, which errors
//   are retryable, and cancelling the in-flight attempt on timeout.
// EFFECT WAY: `Effect.retry` + a `Schedule` ("when to try again", reusable) and `Effect.timeout`.
//   They compose, and a timeout really cancels the work.
//
// WHEN: any call to something you don't control.
// DON'T: retry non-idempotent operations blindly (payments). DON'T retry 4xx/validation errors:
//   use `while:` to retry only transient ones (see infrastructure/resilience.ts in the app).
import { Effect, Schedule, Schema } from "effect"

const section = (title: string) => Effect.sync(() => console.log(`\n── ${title} ──`))
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// ── The regular way ──────────────────────────────────────────────────────────
class RegularFlaky extends Error {}

const regularRetry = async <A>(task: () => Promise<A>, maxRetries: number) => {
  let delay = 10
  for (let attempt = 0; ; attempt++) {
    try {
      return await task()
    } catch (e) {
      const retryable = e instanceof RegularFlaky // easy to forget this check
      if (!retryable || attempt >= maxRetries) throw e
      await sleep(delay)
      delay *= 2 // exponential backoff, by hand
    }
  }
}

const regularWay = async () => {
  let attempts = 0
  const value = await regularRetry(async () => {
    attempts++
    console.log("  attempt", attempts)
    if (attempts < 3) throw new RegularFlaky()
    return "finally"
  }, 5)
  console.log("1. result:", value)

  // Timeout: Promise.race returns early, but the slow task keeps running. It can't be cancelled.
  const slow = sleep(200).then(() => console.log("  (slow task still finished in the background!)"))
  const timedOut = await Promise.race([slow.then(() => "ok"), sleep(50).then(() => "timeout")])
  console.log("2. timeout ->", timedOut)
  await slow // only so the late log line appears before the Effect section
}

// ── The Effect way ───────────────────────────────────────────────────────────
class Flaky extends Schema.TaggedError<Flaky>()("Flaky", {}) {}
class Fatal extends Schema.TaggedError<Fatal>()("Fatal", {}) {}

// A reusable policy: exponential backoff 10ms, 20ms, 40ms..., max 5 retries, only for Flaky.
const retryTransient = <A>(self: Effect.Effect<A, Flaky | Fatal>) =>
  self.pipe(
    Effect.retry({
      schedule: Schedule.exponential("10 millis"),
      times: 5,
      while: (e) => e._tag === "Flaky",
    }),
  )

const effectWay = Effect.gen(function*() {
  // 1) Transient failures are retried with backoff.
  let attempts = 0
  const unreliable: Effect.Effect<string, Flaky | Fatal> = Effect.gen(function*() {
    attempts++
    console.log("  attempt", attempts)
    if (attempts < 3) return yield* new Flaky()
    return "finally"
  })
  console.log("1. result:", yield* unreliable.pipe(retryTransient))

  // 2) Fatal errors are NOT retried: one attempt, then fail.
  let fatalAttempts = 0
  const alwaysFatal: Effect.Effect<never, Flaky | Fatal> = Effect.gen(function*() {
    fatalAttempts++
    return yield* new Fatal()
  })
  const fatal = yield* Effect.result(
    alwaysFatal.pipe(
      Effect.tapError((e) => Effect.log(`attempt ${fatalAttempts} failed with ${e._tag}`)),
      retryTransient,
    ),
  )
  console.log("2. fatal ->", fatal._tag, `after ${fatalAttempts} attempt (not retried)`)

  // 3) Timeout: the slow effect is INTERRUPTED, its cleanup runs, nothing keeps running in the background.
  const slow = Effect.sleep("5 seconds").pipe(
    Effect.onInterrupt(() => Effect.sync(() => console.log("  slow task interrupted (really stopped)"))),
  )
  const timed = yield* Effect.result(slow.pipe(Effect.timeout("50 millis")))
  console.log("3. timeout ->", timed._tag === "Failure" ? timed.failure._tag : "ok")
})

export const main = Effect.gen(function*() {
  yield* section("regular way (hand-written loop + Promise.race)")
  yield* Effect.promise(regularWay)

  yield* section("Effect way (retry + Schedule + timeout)")
  yield* effectWay

  // TIP: tests use TestClock to run all of this instantly (see __tests__/infrastructure.test.ts).
  // YOUR TURN: add `Schedule.jittered` to the schedule: `Schedule.exponential("10 millis").pipe(Schedule.jittered)`.
})
