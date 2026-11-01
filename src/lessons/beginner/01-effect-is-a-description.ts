// LESSON 1 (beginner): An Effect is a DESCRIPTION of work, not the work itself.
//
// PROBLEM: a Promise starts running the moment you create it. You cannot retry it, delay it, time it out, or
//   run it twice, because it is already running (or finished).
// EFFECT WAY: an Effect is a lazy value: "when run, produce a value or fail". Because it hasn't run yet,
//   we can still wrap it: retry it, time it out, trace it, run it N times.
//
//   Effect<Success, Error, Requirements>
//          ^ value   ^ typed failure  ^ dependencies it needs (lesson 5)
//
// WHEN: always. This is the mental model for everything else.
// DON'T: call `Effect.runPromise` in the middle of your code. Run effects ONLY at the edge (a route handler, main).
import { Effect } from "effect"

const section = (title: string) => Effect.sync(() => console.log(`\n── ${title} ──`))

// ── The regular way ──────────────────────────────────────────────────────────
// The body runs the moment the Promise is created. To "run it again" you must remember to call the function again.
const regularWay = async () => {
  let runs = 0
  const makeHello = async () => {
    runs++
    return "hello"
  }

  const promise = makeHello() // already running!
  console.log("1. created a promise. runs =", runs, "(it ran immediately)")

  await promise
  await promise // awaiting twice does NOT run it twice, you just get the cached result
  console.log("2. awaited the same promise twice. runs =", runs)
}

// ── The Effect way ───────────────────────────────────────────────────────────
const effectWay = Effect.gen(function*() {
  let runs = 0
  const hello = Effect.sync(() => {
    runs++
    return "hello"
  })
  console.log("1. created an effect. runs =", runs, "(nothing happened yet)")

  yield* hello
  yield* hello // the same value, run twice -> two runs
  console.log("2. ran the same effect twice. runs =", runs)

  // Because it is a value, we can add behaviour BEFORE running it: "run it, then repeat 2 more times".
  const helloThreeTimes = Effect.repeat(hello, { times: 2 })
  yield* helloThreeTimes
  console.log("3. repeated (1 run + 2 repeats). runs =", runs)
})

export const main = Effect.gen(function*() {
  yield* section("regular way (Promise)")
  yield* Effect.promise(regularWay)

  yield* section("Effect way")
  yield* effectWay

  // YOUR TURN: wrap `hello` with Effect.delay(hello, "1 second") and run it. Try the same with the Promise.
})
