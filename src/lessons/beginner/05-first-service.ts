// LESSON 5 (beginner): Your first service, and where `provide` goes.
//
// A "service" is something your code needs but should not build itself: a database, an HTTP client, a clock.
// Effect makes it a three-step recipe:
//
//   1. DECLARE it      class Greeter extends Context.Service<...>()("Greeter") {}   "I need a Greeter"
//   2. USE it          const greeter = yield* Greeter                                 "give me the Greeter"
//   3. PROVIDE it      effect.pipe(Effect.provide(someLayer))                         "here is a real one"
//
// If you forget step 3, TypeScript refuses to run your program. Wiring mistakes become compile errors.
//
// Lesson 8 covers Layers that build on other Layers. Lesson 17 shows where `provide` lives in Next.js.
import { Context, Effect, Layer } from "effect"

const section = (title: string) => Effect.sync(() => console.log(`\n── ${title} ──`))

// ── The regular way ──────────────────────────────────────────────────────────
// Option A: import a singleton. Easy, but tests must monkey-patch the module to swap it.
// Option B (below): pass the dependency as a parameter. Testable, but every function in between must pass it on,
// and forgetting to pass it is only caught when the code runs.
interface RegularGreeter {
  greet(name: string): string
}
const regularPolite: RegularGreeter = { greet: (n) => `Good day, ${n}.` }
const regularCasual: RegularGreeter = { greet: (n) => `yo ${n}` }

const regularWelcome = (greeter: RegularGreeter, name: string) => greeter.greet(name)

const regularWay = () => {
  console.log(regularWelcome(regularPolite, "Ada"))
  console.log(regularWelcome(regularCasual, "Ada"))
}

// ── The Effect way ───────────────────────────────────────────────────────────
// 1) Declare. The type says what the service can do. No implementation here.
class Greeter extends Context.Service<Greeter, { greet(name: string): Effect.Effect<string> }>()("lesson/Greeter") {}

// A Layer is a recipe that builds an implementation. Two interchangeable ones:
const Polite = Layer.succeed(Greeter, Greeter.of({ greet: (n) => Effect.succeed(`Good day, ${n}.`) }))
const Casual = Layer.succeed(Greeter, Greeter.of({ greet: (n) => Effect.succeed(`yo ${n}`) }))

// 2) Use. No parameter for the greeter: type is Effect<string, never, Greeter>, "needs a Greeter".
const welcome = Effect.fn("welcome")(function*(name: string) {
  const greeter = yield* Greeter
  return yield* greeter.greet(name)
})

// 3) Provide. Same code, different behaviour, decided at the edge.
const effectWay = Effect.gen(function*() {
  console.log(yield* welcome("Ada").pipe(Effect.provide(Polite)))
  console.log(yield* welcome("Ada").pipe(Effect.provide(Casual)))
})

export const main = Effect.gen(function*() {
  yield* section("regular way (pass dependencies by hand)")
  regularWay()

  yield* section("Effect way (service + provide)")
  yield* effectWay

  // In a real app you provide ONCE at the top (lesson 17), not around every call like here.
  // YOUR TURN: delete `.pipe(Effect.provide(Polite))`. TypeScript tells you `Greeter` is missing.
})
