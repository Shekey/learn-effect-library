import { Clock, Effect, Layer, Schedule } from "effect"
import { UserRepository } from "../domain/userRepository"

const TTL_MS = 5_000

// PROBLEM: a cache with a cleanup timer needs start/stop lifecycle code and must not leak on shutdown or hot reload.
// EFFECT WAY: everything started inside a Layer's build is tied to that Layer's Scope. Closing the runtime
//   (runtime.dispose()) interrupts the sweeper fiber and runs the finalizer. No manual stop().
// WHY Clock.currentTimeMillis instead of Date.now(): tests can control the Clock (TestClock) and expire the
//   cache instantly. Date.now() would force real waiting or global fake timers.
// DON'T: setInterval in a module body. Nothing stops it, and each hot reload adds another.
//
// Decorator Layer: requires a UserRepository, provides a UserRepository.
// The sweeper fiber and the finalizer are tied to the layer's Scope: started on build, cleaned up on shutdown. No manual dispose logic.
export const UserRepositoryCached = Layer.effect(
  UserRepository,
  Effect.gen(function*() {
    const inner = yield* UserRepository
    const store = new Map<string, { expiresAt: number; value: unknown }>()

    const sweep = Effect.gen(function*() {
      const now = yield* Clock.currentTimeMillis
      for (const [key, entry] of store) if (entry.expiresAt <= now) store.delete(key)
    })
    yield* Effect.forkScoped(sweep.pipe(Effect.repeat(Schedule.spaced("5 seconds"))))
    yield* Effect.addFinalizer(() => Effect.logInfo(`profile cache closed (${store.size} entries dropped)`))

    const cached = <A, E, R>(key: string, load: Effect.Effect<A, E, R>) =>
      Effect.gen(function*() {
        const now = yield* Clock.currentTimeMillis
        const hit = store.get(key)
        if (hit && hit.expiresAt > now) return hit.value as A
        const value = yield* load
        store.set(key, { expiresAt: now + TTL_MS, value })
        return value
      })

    return UserRepository.of({
      getUser: (id) => cached(`user:${id}`, inner.getUser(id)),
      getPosts: (id) => cached(`posts:${id}`, inner.getPosts(id)),
    })
  }),
)
