// LESSON 17 (advanced): Effect inside Next.js. WHERE do services get provided?
//
// Short answer: ONCE, at the composition root, not in each route. The real files:
//
//   src/features/user-profile/effect/runtime.ts   builds AppLayer, wraps it in a ManagedRuntime, exports `runHttp`
//   src/app/api/effect/profile/[id]/route.ts      builds an Effect, handles errors, calls runHttp(effect, req.signal)
//
// The three steps, shown here in miniature:
//   1. AppLayer           all services wired together (Layer.provide / provideMerge, lesson 8)
//   2. ManagedRuntime     builds that layer ONCE and keeps it (and its resources) alive for the process
//   3. runtime.runPromise the ONLY place an Effect meets Promise-land; services are already provided
//
// That is why there is no `Effect.provide` in the routes: the runtime already contains the services.
//
// Next.js specifics (see runtime.ts): dev hot-reload re-imports modules, so the runtime is cached on
// `globalThis` to avoid building a new one on every edit. `req.signal` is passed to runPromise:
// if the browser disconnects, the whole Effect is interrupted.
import { Context, Effect, Layer, ManagedRuntime } from "effect"

const section = (title: string) => Effect.sync(() => console.log(`\n── ${title} ──`))

// ── The regular way ──────────────────────────────────────────────────────────
// Each route builds (or imports) its own dependencies. A module-level singleton works, but tests must
// monkey-patch the module, and nothing guarantees cleanup on shutdown or cancels work when the client leaves.
class RegularClock {
  now() {
    return "12:00"
  }
}
const regularClock = new RegularClock() // module singleton, shared by every route

const regularGET = async (_req: Request) => new Response(`it is ${regularClock.now()}`)

const regularWay = async () => {
  const response = await regularGET(new Request("http://localhost/api/time"))
  console.log("response body:", await response.text())
}

// ── The Effect way ───────────────────────────────────────────────────────────
class Clock extends Context.Service<Clock, { now(): Effect.Effect<string> }>()("lesson/Clock") {}
const ClockLive = Layer.succeed(Clock, Clock.of({ now: () => Effect.succeed("12:00") }))

// 1) AppLayer: in the app this combines HTTP client, repository, cache, telemetry...
const AppLayer = ClockLive

// 2) One runtime for the whole process. (runtime.ts also caches it on globalThis for hot reload.)
const runtime = ManagedRuntime.make(AppLayer)

// 3) The single entry point, like `runHttp` in runtime.ts. `never` in the error slot forces each route
//    to handle its errors first.
const runHttp = (effect: Effect.Effect<Response, never, Clock>, signal?: AbortSignal) =>
  runtime.runPromise(effect, { signal })

// A route handler: no `provide`, no `new`. It asks for what it needs and runHttp supplies it.
const GET = (req: Request) =>
  runHttp(
    Effect.gen(function*() {
      const clock = yield* Clock
      return new Response(`it is ${yield* clock.now()}`)
    }),
    req.signal,
  )

const effectWay = async () => {
  const response = await GET(new Request("http://localhost/api/time"))
  console.log("response body:", await response.text())
  await runtime.dispose() // on server shutdown: closes every resource the layers opened
}

export const main = Effect.gen(function*() {
  yield* section("regular way (module singleton)")
  yield* Effect.promise(regularWay)

  yield* section("Effect way (ManagedRuntime + runHttp)")
  yield* Effect.promise(effectWay)

  // YOUR TURN: open src/features/user-profile/effect/runtime.ts and a route next to it and find steps 1, 2 and 3.
})
