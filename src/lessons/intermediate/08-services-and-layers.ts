// LESSON 8 (intermediate): Services and Layers (dependency injection the compiler checks)
// (New to this? Start with lesson 5.)
//
// PROBLEM: real services depend on other services (a repository needs an HTTP client, which needs config).
//   In plain TS you wire them by hand with `new`, in the right order, in every entry point and every test.
// EFFECT WAY:
//   Context.Service  = declares a dependency (the PORT: an interface + a key)
//   Layer            = a recipe that BUILDS an implementation (the ADAPTER), possibly using other services
//   Layer.provide    = feed one layer into another; Effect works out the order
//   Effect.provide   = give the finished layer to a program; forgetting one is a COMPILE error
//
// DON'T: import concrete implementations in application code. Depend on the Service, wire in ONE place.
// DON'T: confuse Layer.provide and Layer.provideMerge:
//   provide      -> feeds a layer into another; the fed layer is HIDDEN in the result
//   provideMerge -> feeds it AND keeps it available to the outside
import { Context, Effect, Layer } from "effect"

const section = (title: string) => Effect.sync(() => console.log(`\n── ${title} ──`))

// ── The regular way ──────────────────────────────────────────────────────────
// Manual constructor wiring. Every entry point (route, test, script) repeats this, in the right order.
class RegularHttp {
  get(path: string) {
    return `GET ${path}`
  }
}
class RegularUserRepo {
  constructor(private readonly http: RegularHttp) {}
  findName(id: number) {
    return `${this.http.get(`/users/${id}`)} -> Ada`
  }
}
class RegularCachedUserRepo {
  private readonly cache = new Map<number, string>()
  constructor(private readonly inner: RegularUserRepo) {}
  findName(id: number) {
    if (!this.cache.has(id)) this.cache.set(id, this.inner.findName(id))
    return `${this.cache.get(id)} (cached)`
  }
}

const regularWay = () => {
  const repo = new RegularCachedUserRepo(new RegularUserRepo(new RegularHttp())) // order matters, by hand
  console.log(repo.findName(1))
}

// ── The Effect way ───────────────────────────────────────────────────────────
class Http extends Context.Service<Http, { get(path: string): Effect.Effect<string> }>()("lesson/Http") {}
class UserRepo extends Context.Service<UserRepo, { findName(id: number): Effect.Effect<string> }>()(
  "lesson/UserRepo",
) {}

// Leaf: no dependencies.
const HttpLive = Layer.succeed(Http, Http.of({ get: (path) => Effect.succeed(`GET ${path}`) }))

// Needs Http. Its type says so: Layer<UserRepo, never, Http>.
const UserRepoLive = Layer.effect(
  UserRepo,
  Effect.gen(function*() {
    const http = yield* Http
    return UserRepo.of({
      findName: (id) => Effect.map(http.get(`/users/${id}`), (res) => `${res} -> Ada`),
    })
  }),
)

// A decorator: wraps whatever UserRepo it is given, adds a cache. Same idea as UserRepositoryCached in the app.
const UserRepoCached = Layer.effect(
  UserRepo,
  Effect.gen(function*() {
    const inner = yield* UserRepo
    const cache = new Map<number, string>()
    return UserRepo.of({
      findName: Effect.fn(function*(id) {
        if (!cache.has(id)) cache.set(id, yield* inner.findName(id))
        return `${cache.get(id)} (cached)`
      }),
    })
  }),
)

// Wire it ONCE. Read bottom-up: Http -> UserRepoLive -> UserRepoCached.
const AppLayer = UserRepoCached.pipe(
  Layer.provide(UserRepoLive),
  Layer.provide(HttpLive),
)

// For tests: swap a whole layer, no mocking library.
const UserRepoTest = Layer.succeed(UserRepo, UserRepo.of({ findName: (id) => Effect.succeed(`fake user ${id}`) }))

// The program only knows the port.
const showUser = Effect.fn("showUser")(function*(id: number) {
  const repo = yield* UserRepo
  console.log(yield* repo.findName(id))
})

const effectWay = Effect.gen(function*() {
  yield* showUser(1).pipe(Effect.provide(AppLayer))
  yield* showUser(1).pipe(Effect.provide(UserRepoTest))
})

export const main = Effect.gen(function*() {
  yield* section("regular way (new X(new Y(new Z())))")
  regularWay()

  yield* section("Effect way (Layers)")
  yield* effectWay

  // YOUR TURN: remove `Layer.provide(HttpLive)` from AppLayer. Read the compile error: it names `Http`.
})
