import { Effect, Fiber, Layer, Schema } from "effect"
import { TestClock } from "effect/testing"
import { describe, expect, it } from "@effect/vitest"
import { UpstreamError } from "../effect/domain/errors"
import { UserRepository } from "../effect/domain/userRepository"
import { hedged, withResilience } from "../effect/infrastructure/resilience"
import { mapLimit } from "../standard/application/mapLimit"
import { UpstreamHttp } from "../effect/infrastructure/upstreamHttp"
import { UserRepositoryBatched } from "../effect/infrastructure/userRepositoryBatched"
import { UserRepositoryCached } from "../effect/infrastructure/userRepositoryCached"

// EFFECT WAY: `it.effect` already provides TestClock (virtual time) and a Scope, so there is no hand-written
// `run(effect)` helper that called runPromise with TestClock.layer() provided by hand.
// DON'T: wrap tests in runPromise yourself: a failure becomes a bare rejected promise instead of a readable Cause.

describe("resilience (virtual time: no real waiting)", () => {
  const policy = withResilience({ timeoutMs: 1000, retries: 3 })

  it.effect("retries transient failures with backoff and then succeeds", () =>
    Effect.gen(function*() {
      let attempts = 0
      const flaky = Effect.suspend(() =>
        ++attempts < 3 ? Effect.fail(new UpstreamError({ message: "500" })) : Effect.succeed("ok")
      )
      const fiber = yield* Effect.forkChild(policy(flaky))
      yield* TestClock.adjust("10 seconds") // 100ms + 200ms of backoff, instantly
      expect(yield* Fiber.join(fiber)).toBe("ok")
      expect(attempts).toBe(3)
    }))

  it.effect("times out a hanging call", () =>
    Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(policy(Effect.never as Effect.Effect<never, UpstreamError>).pipe(Effect.flip))
      yield* TestClock.adjust("10 seconds")
      expect((yield* Fiber.join(fiber))._tag).toBe("TimeoutError")
    }))
})

describe("cache layer", () => {
  it.effect("serves from cache within the TTL and reloads after it", () =>
    Effect.gen(function*() {
      let calls = 0
      const Inner = Layer.succeed(UserRepository, UserRepository.of({
        getUser: (id) => Effect.sync(() => (calls++, { id, name: "ada", status: "active" as const })),
        getPosts: () => Effect.succeed([]),
      }))
      const repo = yield* UserRepository.pipe(Effect.provide(UserRepositoryCached.pipe(Layer.provide(Inner))))
      yield* repo.getUser(1)
      yield* repo.getUser(1)
      expect(calls).toBe(1)
      yield* TestClock.adjust("6 seconds")
      yield* repo.getUser(1)
      expect(calls).toBe(2)
    }))
})

describe("concurrency control", () => {
  it.effect("never runs more than `concurrency` tasks at once", () =>
    Effect.gen(function*() {
      let inFlight = 0
      let max = 0
      const task = Effect.gen(function*() {
        max = Math.max(max, ++inFlight)
        yield* Effect.sleep("100 millis")
        inFlight--
      })
      const fiber = yield* Effect.forkChild(Effect.forEach([1, 2, 3, 4, 5, 6], () => task, { concurrency: 2 }))
      yield* TestClock.adjust("1 second")
      yield* Fiber.join(fiber)
      expect(max).toBe(2)
    }))

  it("mapLimit (standard) also bounds concurrency", async () => {
    let inFlight = 0
    let max = 0
    await mapLimit([1, 2, 3, 4, 5, 6], 2, async () => {
      max = Math.max(max, ++inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
    })
    expect(max).toBe(2)
  })

  it.effect("hedged: slow first attempt loses to the second, and the loser is interrupted", () =>
    Effect.gen(function*() {
      let attempts = 0
      let interrupted = 0
      const call = Effect.suspend(() => {
        const n = ++attempts
        return (n === 1 ? Effect.sleep("5 seconds") : Effect.sleep("100 millis")).pipe(
          Effect.as(`attempt ${n}`),
          Effect.onInterrupt(() => Effect.sync(() => { interrupted++ })),
        )
      })
      const fiber = yield* Effect.forkChild(hedged(300)(call))
      yield* TestClock.adjust("1 second")
      expect(yield* Fiber.join(fiber)).toBe("attempt 2")
      expect(attempts).toBe(2)
      expect(interrupted).toBe(1)
    }))
})

describe("request batching", () => {
  it.effect("collapses 4 concurrent getUser calls (3 unique ids) into ONE upstream call", () =>
    Effect.gen(function*() {
      const urls: string[] = []
      // Fake transport: returns wire-shaped users for whatever ids were asked.
      const FakeHttp = Layer.succeed(UpstreamHttp, UpstreamHttp.of({
        getJson: (path, schema) => {
          urls.push(path)
          const ids = new URL(path, "http://x").searchParams.get("ids")!.split(",").map(Number)
          const wire = ids.map((id) => ({ user_id: id, full_name: `u${id}`, state: "A" }))
          return Schema.decodeUnknownEffect(schema)(wire).pipe(Effect.orDie) as never
        },
      }))
      const repo = yield* UserRepository.pipe(Effect.provide(UserRepositoryBatched.pipe(Layer.provide(FakeHttp))))
      const fiber = yield* Effect.forkChild(
        Effect.forEach([1, 2, 1, 3], (id) => repo.getUser(id), { concurrency: "unbounded" }),
      )
      yield* TestClock.adjust("100 millis") // lets the 10ms batching window close, instantly
      const users = yield* Fiber.join(fiber)
      expect(users.map((u) => u.id)).toEqual([1, 2, 1, 3])
      expect(urls).toEqual(["/api/upstream/users?ids=1,2,3"]) // one call, deduped
    }))
})
