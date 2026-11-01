// LESSON 3 (beginner): Effect.gen vs Effect.fn vs pipe: which one when?
//
//  Effect.gen(function*(){...})        an inline block of steps, no parameters
//  Effect.fn("name")(function*(x){})   a REUSABLE FUNCTION returning an Effect; adds a tracing span for free
//  effect.pipe(a, b, c)                decorate an existing Effect: map, timeout, retry, catchTag...
//
// RULE OF THUMB: steps that depend on each other -> gen / fn (like async/await)
//                behaviour wrapped around an effect -> pipe
//
// DON'T: `const f = (x) => Effect.gen(function*(){...})`. Use Effect.fn: same thing, plus a span.
import { Effect } from "effect"

const section = (title: string) => Effect.sync(() => console.log(`\n── ${title} ──`))

// ── The regular way ──────────────────────────────────────────────────────────
// Adding a timeout means editing the call site with Promise.race and a timer you must remember to clear.
const regularAddTax = async (price: number, rate: number) => {
  await new Promise((resolve) => setTimeout(resolve, 5))
  return price * (1 + rate)
}

const withTimeout = <A>(promise: Promise<A>, ms: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms)
  })
  // NOTE: on timeout, the original promise keeps running in the background. It cannot be cancelled.
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

const regularWay = async () => {
  console.log("1. total:", await regularAddTax(100, 0.2))
  const rounded = Math.round(await withTimeout(regularAddTax(100, 0.2), 1000))
  console.log("2. rounded with timeout:", rounded)
}

// ── The Effect way ───────────────────────────────────────────────────────────
// Effect.fn: a reusable function. It gets a span named "addTax" automatically (see lesson 16).
const addTax = Effect.fn("addTax")(function*(price: number, rate: number) {
  yield* Effect.sleep("5 millis")
  return price * (1 + rate)
})

// pipe: add behaviour to an effect without touching its body. Each line is one decoration.
const addTaxRounded = addTax(100, 0.2).pipe(
  Effect.map((total) => Math.round(total)),
  Effect.timeout("1 second"), // on timeout, the inner work is actually cancelled
  Effect.tap((total) => Effect.log(`tap sees ${total}`)),
)

const effectWay = Effect.gen(function*() {
  console.log("1. total:", yield* addTax(100, 0.2))
  console.log("2. rounded with timeout:", yield* addTaxRounded)
})

export const main = Effect.gen(function*() {
  yield* section("regular way")
  yield* Effect.promise(regularWay)

  yield* section("Effect way")
  yield* effectWay

  // YOUR TURN: add `Effect.retry({ times: 2 })` to the pipe above. How would you add a retry to regularWay?
})
