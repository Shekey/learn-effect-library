// LESSON 26 (advanced): Layers & memoization. "Build once, share everywhere", and when you DON'T want that.
// Concept doc: docs/concepts/05-layers-and-memoization.md
//
// PROBLEM (regular way):
//   export const bus = new EventBus()          // module singleton: breaks with hot reload / tests / two bundles
//   const a = new ApiHandler(new EventBus())   // or each caller news its own: publisher and subscriber
//   const b = new SseRoute(new EventBus())     //   now talk to DIFFERENT buses and events silently vanish
// EFFECT WAY:
//   A Layer is a RECIPE (how to build a service) + a LIFETIME (its Scope). Layers are memoized by reference:
//   inside one build (one MemoMap) the same layer value is constructed ONCE and shared by everyone who needs it.
//   Two separate builds = two MemoMaps = two copies, unless you hand them the same MemoMap (todos/runtime.ts).
// DON'T: call Effect.provide(layer) in several places and expect them to share state. Each provide is its own
//   build. Compose layers first, provide ONCE at the edge.
import { Config, ConfigProvider, Context, Effect, Layer, ManagedRuntime } from "effect"

const section = (title: string) => Effect.sync(() => console.log(`\n── ${title} ──`))

// A service whose constructor is LOUD, so we can count how many times it is built.
let builds = 0
class Bus extends Context.Service<Bus, { readonly id: number }>()("lesson26/Bus") {
  static readonly layer = Layer.effect(
    Bus,
    Effect.gen(function*() {
      const id = ++builds
      console.log(`  [Bus] constructor #${id}`)
      // Scoped layer: it owns a "resource" and releases it when the layer's scope closes.
      yield* Effect.addFinalizer(() => Effect.sync(() => console.log(`  [Bus] #${id} released`)))
      return Bus.of({ id })
    }),
  )
}

// Two consumers that both depend on Bus (think: the HTTP API and the SSE route).
class Api extends Context.Service<Api, { readonly busId: number }>()("lesson26/Api") {
  static readonly layer = Layer.effect(Api, Effect.map(Effect.service(Bus), (b) => Api.of({ busId: b.id })))
}
class Sse extends Context.Service<Sse, { readonly busId: number }>()("lesson26/Sse") {
  static readonly layer = Layer.effect(Sse, Effect.map(Effect.service(Bus), (b) => Sse.of({ busId: b.id })))
}

const report = Effect.gen(function*() {
  const api = yield* Api
  const sse = yield* Sse
  const verdict = api.busId === sse.busId ? "(shared)" : "(DIFFERENT!)"
  console.log(`  api sees bus #${api.busId}, sse sees bus #${sse.busId} ${verdict}`)
})

// ── The regular way (not executed: shown for comparison) ─────────────────────
const regularWay = Effect.sync(() =>
  console.log(`  const api = new ApiHandler(new EventBus())
  const sse = new SseRoute(new EventBus())   // oops: two buses, events published by api never reach sse`)
)

// ── The Effect way ───────────────────────────────────────────────────────────
export const main = Effect.gen(function*() {
  yield* section("Regular way")
  yield* regularWay

  // 1. One build: both consumers ask for Bus.layer (the SAME value) -> built once.
  yield* section("1. One graph, one build -> constructor runs ONCE")
  builds = 0
  const shared = Layer.mergeAll(Api.layer, Sse.layer).pipe(Layer.provide(Bus.layer))
  yield* report.pipe(Effect.provide(shared))

  // 2. Layer.fresh opts out of memoization: each use gets its own instance.
  yield* section("2. Layer.fresh -> constructor runs TWICE")
  builds = 0
  const fresh = Layer.mergeAll(
    Api.layer.pipe(Layer.provide(Layer.fresh(Bus.layer))),
    Sse.layer.pipe(Layer.provide(Layer.fresh(Bus.layer))),
  )
  yield* report.pipe(Effect.provide(fresh))

  // 3. The todos/runtime.ts bug: two SEPARATE runtimes building the same layer. No shared MemoMap -> 2 buses.
  yield* section("3. Two runtimes, separate MemoMaps -> TWO buses (the bug)")
  builds = 0
  const rtA = ManagedRuntime.make(Api.layer.pipe(Layer.provide(Bus.layer)))
  const rtB = ManagedRuntime.make(Sse.layer.pipe(Layer.provide(Bus.layer)))
  const a1 = yield* Effect.promise(() => rtA.runPromise(Effect.service(Api)))
  const b1 = yield* Effect.promise(() => rtB.runPromise(Effect.service(Sse)))
  console.log(`  api bus #${a1.busId}, sse bus #${b1.busId}  <- publish on one, subscribe on the other: nothing arrives`)
  yield* Effect.promise(() => Promise.all([rtA.dispose(), rtB.dispose()]))

  // 4. The fix used in todos/runtime.ts: pass the first runtime's memoMap to the second build.
  yield* section("4. Shared MemoMap -> ONE bus (the fix)")
  builds = 0
  const rt1 = ManagedRuntime.make(Api.layer.pipe(Layer.provide(Bus.layer)))
  const rt2 = ManagedRuntime.make(Sse.layer.pipe(Layer.provide(Bus.layer)), { memoMap: rt1.memoMap })
  const a2 = yield* Effect.promise(() => rt1.runPromise(Effect.service(Api)))
  const b2 = yield* Effect.promise(() => rt2.runPromise(Effect.service(Sse)))
  console.log(`  api bus #${a2.busId}, sse bus #${b2.busId}  <- same instance`)
  yield* Effect.promise(() => rt2.dispose().then(() => rt1.dispose()))

  // 5. provide vs provideMerge: provide HIDES the dependency, provideMerge also EXPOSES it.
  yield* section("5. provide vs provideMerge")
  builds = 0
  const hidden = Api.layer.pipe(Layer.provide(Bus.layer)) //        Layer<Api>
  const exposed = Api.layer.pipe(Layer.provideMerge(Bus.layer)) //   Layer<Api | Bus>
  yield* Effect.gen(function*() {
    const api = yield* Api
    console.log(`  provide:      only Api is visible (yield* Bus here = TYPE error). api->#${api.busId}`)
  }).pipe(Effect.provide(hidden))
  yield* Effect.gen(function*() {
    const api = yield* Api
    const bus = yield* Bus
    console.log(`  provideMerge: Api AND Bus visible, same instance: api->#${api.busId} bus->#${bus.id}`)
  }).pipe(Effect.provide(exposed))

  // 6. Layer.unwrap: decide WHICH layer to build from config (todos/runtime.ts picks Postgres vs memory).
  yield* section("6. Layer.unwrap: choose the adapter from config")
  const Memory = Layer.succeed(Bus, Bus.of({ id: 100 }))
  const Postgres = Layer.succeed(Bus, Bus.of({ id: 200 }))
  const BusLive = Layer.unwrap(
    Effect.gen(function*() {
      const useDb = yield* Config.Boolean("USE_DB").pipe(Config.withDefault(false))
      return useDb ? Postgres : Memory
    }),
  )
  const pick = Effect.map(Effect.service(Bus), (b) => (b.id === 200 ? "Postgres" : "Memory"))
  console.log("  USE_DB unset ->", yield* pick.pipe(Effect.provide(BusLive)))
  const withDb = ConfigProvider.layer(ConfigProvider.fromUnknown({ USE_DB: "true" }))
  console.log("  USE_DB=true  ->", yield* pick.pipe(Effect.provide(BusLive), Effect.provide(withDb)))
  console.log("\n  (every `[Bus] #n released` line above = a scoped layer closing its resource)")
})
