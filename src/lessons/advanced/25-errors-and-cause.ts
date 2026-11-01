// LESSON 25 (advanced): Errors deep dive. Failure vs defect vs interruption, Exit, Cause.
// Concept doc: docs/concepts/04-errors-and-cause.md
//
// PROBLEM (regular async/await):
//   try { await Promise.all([a(), b()]) } catch (e) { ... }
//   - `e` is `unknown`: a "user not found" and a "cannot read property of undefined" look the same.
//   - Promise.all keeps only the FIRST rejection. If b() also failed, that error is silently gone.
//   - A cancelled request (AbortError) is just another thrown thing.
// EFFECT WAY:
//   An Effect ends in exactly one Exit: Success(value) or Failure(cause).
//   A Cause is a list of reasons, each one of:
//     Fail(error)      -> expected, typed in E      ("the caller can do something about it")
//     Die(defect)      -> a bug, NOT in E          ("the caller can't fix it, crash loudly")
//     Interrupt(fiber) -> someone stopped us        ("nobody failed, we were cancelled")
//   Parallel failures are ALL kept in the Cause. Nothing is lost.
// DON'T: catch everything with catchCause "to be safe". Handle Fail with catchTag/catchTags,
//   let Die reach the edge (logs/500), and let interruption just happen.
import { Cause, Effect, Exit, Schema } from "effect"

const section = (title: string) => Effect.sync(() => console.log(`\n── ${title} ──`))

class UserNotFound extends Schema.TaggedError<UserNotFound>()("UserNotFound", { id: Schema.String }) {}
class RateLimited extends Schema.TaggedError<RateLimited>()("RateLimited", { retryAfterMs: Schema.Number }) {}

// ── The regular way (not executed: shown for comparison) ─────────────────────
const regularWay = Effect.sync(() =>
  console.log(`  try { await Promise.all([loadUser("1"), loadPosts("1")]) }
  catch (e) { /* e: unknown, and only the FIRST rejection. The second error is gone. */ }`)
)

// ── 1. Three ways to end ─────────────────────────────────────────────────────
const failure = Effect.fail(new UserNotFound({ id: "42" })) // Effect<never, UserNotFound>
const defect = Effect.die(new Error("bug: config was undefined")) // Effect<never, never>  <- not in E!
const interruption = Effect.interrupt // Effect<never, never>

const describe = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.match(exit, {
    onSuccess: (a) => `Success(${String(a)})`,
    onFailure: (cause) =>
      cause.reasons.map((r) =>
        Cause.isFailReason(r)
          ? `Fail(${(r.error as { _tag?: string })._tag})`
          : Cause.isDieReason(r)
          ? `Die(${String(r.defect)})`
          : "Interrupt"
      ).join(" + "),
  })

const threeWays = Effect.gen(function*() {
  for (const [name, eff] of [["failure", failure], ["defect", defect], ["interruption", interruption]] as const) {
    const exit = yield* Effect.exit(eff) // Effect.exit never fails: it turns the outcome into a value
    console.log(`  ${name.padEnd(13)} -> ${describe(exit)}`)
  }
})

// ── 2. A parallel failure: read a real Cause ─────────────────────────────────
// uninterruptible: each call finishes even when a sibling fails first (think: an HTTP request already in
// flight). Without it, the first failure interrupts the others and you'd only see that one Fail.
const loadUser = Effect.fail(new UserNotFound({ id: "1" })).pipe(Effect.delay("10 millis"), Effect.uninterruptible)
const loadPosts = Effect.fail(new RateLimited({ retryAfterMs: 500 })).pipe(
  Effect.delay("20 millis"),
  Effect.uninterruptible,
)
// A slow, normal (interruptible) sibling: it gets stopped when the others fail. That stop is cleanup done
// BY Effect.all, not a reason the whole thing failed, so it doesn't show up as an Interrupt in the Cause.
const loadAvatar = Effect.sleep("1 second").pipe(Effect.as("avatar.png"))

const parallel = Effect.gen(function*() {
  // All three run concurrently. The first failure asks the others to stop, but they're uninterruptible,
  // so they finish and fail too. Every one of those failures lands in the SAME Cause.
  const exit = yield* Effect.exit(
    Effect.all([loadUser, loadPosts, loadAvatar], { concurrency: "unbounded" }),
  )
  if (Exit.isSuccess(exit)) return
  const cause = exit.cause
  console.log("  Cause.pretty(cause):\n")
  // Stack-trace lines are trimmed so the shape is easy to see.
  const pretty = Cause.pretty(cause).split("\n").filter((l) => !l.trim().startsWith("at "))
  console.log(pretty.map((l) => "    " + l).join("\n"))
  console.log("\n  Walking through it, reason by reason:")
  cause.reasons.forEach((r, i) => {
    const kind = Cause.isFailReason(r)
      ? `Fail      error=${JSON.stringify(r.error)}`
      : Cause.isDieReason(r)
      ? `Die       defect=${String(r.defect)}`
      : `Interrupt (a sibling was stopped because another one failed)`
    console.log(`    [${i}] ${kind}`)
  })
  console.log(`  hasFails=${Cause.hasFails(cause)} hasDies=${Cause.hasDies(cause)} hasInterrupts=${
    Cause.hasInterrupts(cause)
  }`)
  console.log("  Promise.all would have shown you ONE of these. The Cause shows all of them.")
})

// ── 3. orDie: "can the caller do anything about it?" ─────────────────────────
// A DB connection error inside a repository: the HTTP handler can't fix it -> make it a defect.
// UserNotFound: the handler CAN do something (return 404) -> keep it typed.
class DbDown extends Schema.TaggedError<DbDown>()("DbDown", {}) {}
const findUser = (id: string): Effect.Effect<string, UserNotFound | DbDown> =>
  id === "1" ? Effect.succeed("Ada") : id === "db" ? Effect.fail(new DbDown()) : Effect.fail(new UserNotFound({ id }))

// Effect<string, UserNotFound>: DbDown is gone from the type, it becomes a Die.
const findUserForHandler = (id: string) => findUser(id).pipe(Effect.catchTag("DbDown", (e) => Effect.die(e)))

const orDieDemo = Effect.gen(function*() {
  console.log("  findUser('db') typed  :", describe(yield* Effect.exit(findUser("db"))))
  console.log("  after DbDown -> die   :", describe(yield* Effect.exit(findUserForHandler("db"))))
  console.log("  (Effect.orDie does this for EVERY error. todoRepositorySql.ts does it only for infra errors.)")
})

// ── 4. The handler toolbox ───────────────────────────────────────────────────
const program: Effect.Effect<string, UserNotFound | RateLimited> = Effect.fail(new RateLimited({ retryAfterMs: 500 }))

const toolbox = Effect.gen(function*() {
  // catchTags: one handler per _tag. Handled tags disappear from E. Defects pass straight through.
  const a = yield* program.pipe(Effect.catchTags({
    UserNotFound: () => Effect.succeed("404"),
    RateLimited: (e) => Effect.succeed(`429 retry in ${e.retryAfterMs}ms`),
  }))
  console.log("  catchTags  ->", a)

  // catch: every typed failure, one handler. Defects still pass through.
  const b = yield* program.pipe(Effect.catch((e) => Effect.succeed(`caught ${e._tag}`)))
  console.log("  catch      ->", b)

  // catchCause: sees the WHOLE Cause, including Die and Interrupt. Use at the edge (logging, 500 page).
  const c = yield* defect.pipe(Effect.catchCause((cause) => Effect.succeed(`edge saw: ${describe(Exit.failCause(cause))}`)))
  console.log("  catchCause ->", c)

  // sandbox: moves the Cause INTO the error channel, so normal combinators work on it.
  const d = yield* defect.pipe(
    Effect.sandbox, // Effect<never, Cause<never>>
    Effect.catch((cause) => Effect.succeed(`sandboxed, hasDies=${Cause.hasDies(cause)}`)),
  )
  console.log("  sandbox    ->", d)

  // And the DON'T: catch does NOT see defects. This one still dies:
  const e = yield* Effect.exit(defect.pipe(Effect.catch(() => Effect.succeed("never printed"))))
  console.log("  catch on a defect ->", describe(e), "(good: bugs are not swallowed)")
})

export const main = Effect.gen(function*() {
  yield* section("The regular way")
  yield* regularWay
  yield* section("1. Three ways an Effect can end")
  yield* threeWays
  yield* section("2. A parallel failure: reading a real Cause")
  yield* parallel
  yield* section("3. orDie vs typed: can the caller do anything about it?")
  yield* orDieDemo
  yield* section("4. catchTags vs catch vs catchCause vs sandbox")
  yield* toolbox
})
