// LESSON 4 (beginner): Errors you can SEE in the type.
//
// In plain TypeScript, `throw` is invisible: nothing in a function's signature says it can fail.
// In Effect, a failure is part of the type:
//
//   Effect<string, NotFound>
//          ^ success  ^ the ways it can fail
//
// Three things to learn here:
//   1. make an error        class NotFound extends Schema.TaggedError(...)
//   2. fail with it         return yield* new NotFound(...)
//   3. handle it            Effect.catchTag("NotFound", ...)
//
// Lesson 7 (intermediate) goes deeper: several errors at once, defects, exhaustive handling.
import { Effect, Schema } from "effect"

const section = (title: string) => Effect.sync(() => console.log(`\n── ${title} ──`))

// ── The regular way ──────────────────────────────────────────────────────────
class RegularNotFound extends Error {
  constructor(readonly id: number) {
    super(`user ${id} not found`)
  }
}

// Type: (id: number) => Promise<string>. Nothing tells the caller it can throw.
const regularFindUser = async (id: number) => {
  if (id === 404) throw new RegularNotFound(id)
  return `user ${id}`
}

const regularWay = async () => {
  console.log("1. found:", await regularFindUser(1))

  try {
    await regularFindUser(404)
  } catch (e) {
    // `e` is unknown: we need instanceof, and nothing reminds us to write this try/catch at all.
    if (e instanceof RegularNotFound) console.log("2. recovered:", `no user with id ${e.id}, using a guest`)
    else throw e
  }
}

// ── The Effect way ───────────────────────────────────────────────────────────
// 1) An error is a small class with a `_tag`. The tag is how we tell errors apart.
class NotFound extends Schema.TaggedError<NotFound>()("NotFound", { id: Schema.Number }) {}

// 2) Type: (id: number) => Effect<string, NotFound>. Hover it in your editor.
const findUser = Effect.fn("findUser")(function*(id: number) {
  if (id === 404) return yield* new NotFound({ id }) // `return` so TypeScript knows we stop here
  return `user ${id}`
})

const effectWay = Effect.gen(function*() {
  console.log("1. found:", yield* findUser(1))

  // 3) Handle the failure: turn NotFound into a normal value. `e` is typed as NotFound.
  const guest = yield* findUser(404).pipe(
    Effect.catchTag("NotFound", (e) => Effect.succeed(`no user with id ${e.id}, using a guest`)),
  )
  console.log("2. recovered:", guest)

  // Another way: Effect.result turns "success or failure" into plain data for if/else.
  const result = yield* Effect.result(findUser(404))
  if (result._tag === "Failure") console.log("3. failed with tag:", result.failure._tag)
  else console.log("3. success:", result.success)

  // Another way: a default value whatever the error is.
  const withDefault = yield* findUser(404).pipe(Effect.orElseSucceed(() => "default user"))
  console.log("4. default:", withDefault)
})

export const main = Effect.gen(function*() {
  yield* section("regular way (throw + try/catch)")
  yield* Effect.promise(regularWay)

  yield* section("Effect way (typed errors)")
  yield* effectWay

  // YOUR TURN: add `class Banned ...` and make findUser(13) fail with it. Hover `findUser` again.
})
