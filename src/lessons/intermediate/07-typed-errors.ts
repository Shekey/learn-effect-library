// LESSON 7 (intermediate): Typed errors in depth. Failures vs defects.
// (New to this? Start with lesson 4.)
//
// PROBLEM: with `throw`, a function's signature never says what can go wrong. Add a new error and no caller
//   notices until production.
// EFFECT WAY: expected errors are part of the type (`Effect<A, NotFound | Banned>`). `catchTags` is checked
//   by the compiler: handle every case, or explicitly pass the rest on.
//
//  FAILURE (expected, recoverable)   `yield* new MyError()`              -> in the E type, you handle it
//  DEFECT  (bug, unrecoverable)      throw / Effect.die / Effect.orDie   -> NOT in the type, crashes up
//
// WHEN a failure: the caller can do something about it (404, validation, banned user).
// WHEN a defect: programmer errors / impossible states. `orDie` says "treat any E here as a bug".
//
// DON'T: catch everything with `Effect.catch(() => ...)`: new error types silently disappear.
// DON'T: use `string` or `Error` as the error type: you lose `_tag` and exhaustive matching.
import { Effect, Schema } from "effect"

const section = (title: string) => Effect.sync(() => console.log(`\n── ${title} ──`))

// ── The regular way ──────────────────────────────────────────────────────────
class RegularNotFound extends Error {}
class RegularBanned extends Error {}

const regularLoad = async (id: number) => {
  if (id === 404) throw new RegularNotFound()
  if (id === 13) throw new RegularBanned()
  return `user ${id}`
}

// If someone adds `class RegularSuspended` to regularLoad, this function still compiles and
// silently falls into the `throw e` branch in production.
const regularToMessage = async (id: number) => {
  try {
    return await regularLoad(id)
  } catch (e) {
    if (e instanceof RegularNotFound) return `404 for ${id}`
    if (e instanceof RegularBanned) return `403 for ${id}`
    throw e
  }
}

const regularWay = async () => {
  for (const id of [1, 404, 13]) console.log(id, "->", await regularToMessage(id))
}

// ── The Effect way ───────────────────────────────────────────────────────────
class NotFound extends Schema.TaggedError<NotFound>()("NotFound", { id: Schema.Number }) {}
class Banned extends Schema.TaggedError<Banned>()("Banned", { id: Schema.Number }) {}

// Type: (id: number) => Effect<string, NotFound | Banned>
const load = Effect.fn("load")(function*(id: number) {
  if (id === 404) return yield* new NotFound({ id })
  if (id === 13) return yield* new Banned({ id })
  return `user ${id}`
})

// Exhaustive: add a third error to `load` and this stops compiling until you handle it.
const toMessage = (id: number) =>
  load(id).pipe(
    Effect.catchTags({
      NotFound: (e) => Effect.succeed(`404 for ${e.id}`),
      Banned: (e) => Effect.succeed(`403 for ${e.id}`),
    }),
  )

const effectWay = Effect.gen(function*() {
  // 1) Handle ALL cases by tag.
  for (const id of [1, 404, 13]) console.log("1.", id, "->", yield* toMessage(id))

  // 2) Handle ONE case, let the rest flow on. Type shrinks to Effect<string, Banned>.
  const onlyNotFoundHandled = load(404).pipe(Effect.catchTag("NotFound", () => Effect.succeed("fallback")))
  console.log("2. partial ->", yield* onlyNotFoundHandled)

  // 3) Turn the outcome into data: Effect.result never fails.
  const result = yield* Effect.result(load(13))
  console.log("3. as data ->", result._tag, result._tag === "Failure" ? result.failure._tag : "")

  // 4) Defects: orDie removes the error from the type. If it happens anyway, it's a crash (a bug).
  const exit = yield* Effect.exit(load(404).pipe(Effect.orDie))
  console.log("4. orDie ->", exit._tag, "(a defect, not a typed failure)")
})

export const main = Effect.gen(function*() {
  yield* section("regular way (instanceof chain)")
  yield* Effect.promise(regularWay)

  yield* section("Effect way (catchTags)")
  yield* effectWay

  // YOUR TURN: add `class Suspended ...` and fail with it in `load` for id 99. Run `npx tsc --noEmit`:
  // `toMessage` is now a compile error. Do the same in regularLoad: nothing complains.
})
