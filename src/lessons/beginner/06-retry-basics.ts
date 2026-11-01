// LESSON 6 (beginner): Retrying, and logging each attempt.
//
//   Effect.retry({ times: 3 })      run it again (up to 3 more times) when it FAILS
//   Effect.tapError(...)            peek at a failure (for logging) without changing it
//
// Two things beginners trip over:
//   a) `Effect.tap` only runs on SUCCESS. To observe failures use `Effect.tapError`.
//   b) `Effect.fail(...)` is built ONCE. To behave differently per attempt, put the logic inside `Effect.gen`:
//      its body runs again on every retry.
//
// Lesson 10 (intermediate) adds backoff, timeouts and "retry only some errors".
import { Effect, Schema } from "effect"

const section = (title: string) => Effect.sync(() => console.log(`\n── ${title} ──`))

// ── The regular way ──────────────────────────────────────────────────────────
// A hand-written loop. Works, but every call site re-implements it (and usually forgets backoff or limits).
const regularWay = async () => {
  let attempts = 0
  const unreliable = async () => {
    attempts++
    if (attempts < 3) throw new Error("flaky")
    return "finally worked"
  }

  const maxRetries = 5
  let lastError: unknown
  for (let i = 0; i <= maxRetries; i++) {
    try {
      console.log(`attempt ${attempts + 1}`)
      const value = await unreliable()
      console.log("result:", value, `(after ${attempts} attempts)`)
      return
    } catch (e) {
      lastError = e
      console.log("failed, will retry")
    }
  }
  throw lastError
}

// ── The Effect way ───────────────────────────────────────────────────────────
class Flaky extends Schema.TaggedError<Flaky>()("Flaky", {}) {}

const effectWay = Effect.gen(function*() {
  // Example 1: fails twice, succeeds on the third try.
  let attempts = 0
  const unreliable = Effect.gen(function*() {
    attempts++ // counted INSIDE the effect, so every run is counted
    yield* Effect.log(`attempt ${attempts}`)
    if (attempts < 3) return yield* new Flaky()
    return "finally worked"
  })

  const value = yield* unreliable.pipe(
    Effect.tapError(() => Effect.log("failed, will retry")),
    Effect.retry({ times: 5 }),
  )
  console.log("result:", value, `(after ${attempts} attempts)`)

  // Example 2: always fails. After the retries run out, the LAST error comes out.
  let badAttempts = 0
  const alwaysBad = Effect.gen(function*() {
    badAttempts++
    return yield* new Flaky()
  })
  const gaveUp = yield* Effect.result(alwaysBad.pipe(Effect.retry({ times: 2 })))
  console.log("gave up ->", gaveUp._tag, `after ${badAttempts} attempts (1 try + 2 retries)`)
})

export const main = Effect.gen(function*() {
  yield* section("regular way (for loop + try/catch)")
  yield* Effect.promise(regularWay)

  yield* section("Effect way (Effect.retry)")
  yield* effectWay

  // YOUR TURN: change `times: 5` to `times: 1` in example 1. What comes back, and why?
})
