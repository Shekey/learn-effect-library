// LESSON 2 (beginner): Effect.gen and `yield*`  (the thing everyone asks about)
//
// `Effect.gen(function*() { ... })` reads like async/await:
//     async/await                 Effect.gen
//     async function              Effect.gen(function*() {
//     await somePromise           yield* someEffect
//     throw new MyError()         return yield* new MyError()
//
// `yield*` means: "run this Effect here and give me its value; if it FAILS, stop this block and pass the error on".
//
// WHEN to use yield*:
//   - get the value out of an Effect       const user = yield* getUser(1)
//   - get a service (lesson 5)             const repo = yield* UserRepository
//   - fail with a typed error              return yield* new NotFound(...)
//   - run things in parallel               const [a, b] = yield* Effect.all([x, y])
//
// DON'T:
//   - `yield` without the star: you get the Effect itself, not its value (a classic bug)
//   - `await` inside Effect.gen: wrap promises with `yield* Effect.tryPromise(...)`
//   - forget `return` before `yield* new MyError()`: TypeScript then thinks the code continues
import { Effect, Schema } from "effect"

const section = (title: string) => Effect.sync(() => console.log(`\n── ${title} ──`))

// ── The regular way ──────────────────────────────────────────────────────────
class RegularTooSmall extends Error {}

const regularDouble = async (n: number) => n * 2
const regularMustBeBig = async (n: number) => {
  if (n < 10) throw new RegularTooSmall(`${n} is too small`) // invisible in the type: Promise<number>
  return n
}

const regularWay = async () => {
  const a = await regularDouble(4)
  console.log("1. a =", a)

  try {
    await regularMustBeBig(a)
    console.log("never printed")
  } catch (e) {
    // `e` is `unknown`. We have to guess what it is.
    console.log("2. caught:", e instanceof RegularTooSmall ? "TooSmall" : "something else")
  }

  const [x, y] = await Promise.all([regularDouble(1), regularDouble(2)])
  console.log("3. parallel:", x, y)
}

// ── The Effect way ───────────────────────────────────────────────────────────
class TooSmall extends Schema.TaggedError<TooSmall>()("TooSmall", { n: Schema.Number }) {}

const double = (n: number) => Effect.succeed(n * 2)

// Type: (n: number) => Effect<number, TooSmall>. The failure is visible.
const mustBeBig = Effect.fn("mustBeBig")(function*(n: number) {
  if (n < 10) return yield* new TooSmall({ n })
  return n
})

const effectWay = Effect.gen(function*() {
  const a = yield* double(4) // a: number. Without the *, `a` would be an Effect!
  console.log("1. a =", a)

  // A failing yield* stops the block. Effect.result turns the outcome into data we can inspect.
  const outcome = yield* Effect.result(
    Effect.gen(function*() {
      yield* mustBeBig(a)
      console.log("never printed")
    }),
  )
  console.log("2. outcome:", outcome._tag === "Failure" ? `failed with ${outcome.failure._tag}` : "ok")

  const [x, y] = yield* Effect.all([double(1), double(2)], { concurrency: 2 })
  console.log("3. parallel:", x, y)

  // Wrapping a Promise: the bridge from regular code into Effect.
  const fromPromise = yield* Effect.tryPromise({
    try: () => regularDouble(21),
    catch: (cause) => new Error(String(cause)),
  })
  console.log("4. from a promise:", fromPromise)
})

export const main = Effect.gen(function*() {
  yield* section("regular way (async/await)")
  yield* Effect.promise(regularWay)

  yield* section("Effect way (Effect.gen)")
  yield* effectWay

  // YOUR TURN: remove the `*` from `yield* double(4)` and read the TypeScript error.
})
