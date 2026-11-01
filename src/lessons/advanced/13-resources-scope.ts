// LESSON 13 (advanced): Resources and Scope (cleanup that cannot be forgotten)
//
// PROBLEM: connections, timers, file handles, background loops must be closed on success, failure, timeout AND
//   cancellation. try/finally covers some of it, and it is easy to miss a path or leak a timer.
// EFFECT WAY: acquire a resource inside a Scope with its release attached. When the Scope closes
//   (normally, on error, or on interruption), every release runs, in reverse order.
//
//   Effect.acquireRelease(acquire, release)   a resource with guaranteed cleanup
//   Effect.addFinalizer(...)                  "run this when the scope closes"
//   Effect.forkScoped(effect)                 a background fiber that dies with the scope
//   Effect.scoped(effect)                     open + close a scope around an effect
//   Layer.effect(...)                         a Layer is a scope too: resources live as long as the app
//
// WHEN: DB pools, caches with sweepers, WebSocket clients, any setInterval.
// DON'T: setInterval without a matching clear. Use forkScoped + Schedule.
import { Effect, Schedule } from "effect"

const section = (title: string) => Effect.sync(() => console.log(`\n── ${title} ──`))
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// ── The regular way ──────────────────────────────────────────────────────────
// Every resource needs its own try/finally, and a timeout must be wired to the cleanup by hand.
const regularWay = async () => {
  console.log("open connection")
  const connection = { id: 1 }
  const heartbeat = setInterval(() => console.log("  heartbeat"), 30)
  try {
    console.log("using connection", connection.id)
    await sleep(100)
  } finally {
    clearInterval(heartbeat) // forget this line and the process never exits
    console.log(`close connection ${connection.id}`)
  }
  // If a caller gives up (timeout / client disconnect), nothing here is told about it. The work just continues.
}

// ── The Effect way ───────────────────────────────────────────────────────────
const openConnection = Effect.acquireRelease(
  Effect.sync(() => {
    console.log("open connection")
    return { id: 1 }
  }),
  (connection) => Effect.sync(() => console.log(`close connection ${connection.id}`)),
)

const heartbeat = Effect.log("heartbeat").pipe(Effect.repeat(Schedule.spaced("30 millis")))

const happyPath = Effect.scoped(
  Effect.gen(function*() {
    const connection = yield* openConnection
    yield* Effect.forkScoped(heartbeat) // stops automatically when the scope closes
    yield* Effect.addFinalizer(() => Effect.sync(() => console.log("finalizer: all done")))

    console.log("using connection", connection.id)
    yield* Effect.sleep("100 millis")
  }),
)

// The same cleanup also runs when the work FAILS or is INTERRUPTED (here by a timeout).
const guarded = (label: string) =>
  Effect.acquireRelease(
    Effect.sync(() => console.log(`  [${label}] acquired`)),
    () => Effect.sync(() => console.log(`  [${label}] released`)),
  )

const failurePath = Effect.scoped(guarded("on failure").pipe(Effect.andThen(Effect.fail("boom"))))
const interruptPath = Effect.scoped(guarded("on timeout").pipe(Effect.andThen(Effect.sleep("5 seconds")))).pipe(
  Effect.timeout("30 millis"),
)

export const main = Effect.gen(function*() {
  yield* section("regular way (try/finally + clearInterval)")
  yield* Effect.promise(regularWay)

  yield* section("Effect way: success")
  yield* happyPath

  yield* section("Effect way: failure")
  console.log("result ->", (yield* Effect.result(failurePath))._tag)

  yield* section("Effect way: interruption")
  console.log("result ->", (yield* Effect.result(interruptPath))._tag)

  // YOUR TURN: add a second acquireRelease to happyPath. In which order are they released?
})
