import { Effect, Layer } from "effect"
import { describe, expect, it } from "@effect/vitest"
import { canViewProfile, toProfile } from "../domain/profile"
import { NotFoundError } from "../effect/domain/errors"
import { UserRepository } from "../effect/domain/userRepository"
import { getUserProfile as getUserProfileEffect } from "../effect/application/getUserProfile"
import { getUserProfile as getUserProfileStd } from "../standard/application/getUserProfile"

const user = { id: 1, name: " ada ", status: "active" as const }
const posts = [{ id: 1, userId: 1, title: "hi" }]

describe("domain", () => {
  it("applies the profile rule", () => {
    expect(toProfile(user, posts)).toEqual({ displayName: "ADA", postCount: 1, level: "newbie" })
  })
})

describe("domain rules", () => {
  it("promotes users with 3+ posts and blocks banned users", () => {
    expect(toProfile(user, [...posts, ...posts, ...posts]).level).toBe("pro")
    expect(canViewProfile({ ...user, status: "banned" })).toBe(false)
  })
})

describe("standard: pass the fake by hand", () => {
  it("builds a profile", async () => {
    const fake = { getUser: async () => user, getPosts: async () => posts }
    expect(await getUserProfileStd(fake, 1)).toEqual({ displayName: "ADA", postCount: 1, level: "newbie" })
  })
})

describe("effect: swap a Layer, use case untouched", () => {
  const FakeRepo = Layer.succeed(UserRepository, UserRepository.of({
    getUser: (id) => (id === 1 ? Effect.succeed(user) : Effect.fail(new NotFoundError({ resource: `${id}` }))),
    getPosts: () => Effect.succeed(posts),
  }))

  // EFFECT WAY: `it.effect` runs the Effect for us (no runPromise), and a failure prints the full Cause.
  it.effect("builds a profile", () =>
    Effect.gen(function*() {
      const result = yield* getUserProfileEffect(1).pipe(Effect.provide(FakeRepo))
      expect(result).toEqual({ displayName: "ADA", postCount: 1, level: "newbie" })
    }))

  it.effect("fails with a typed UserBannedError for banned users", () => Effect.gen(function*() {
    const Banned = Layer.succeed(UserRepository, UserRepository.of({
      getUser: () => Effect.succeed({ ...user, status: "banned" as const }),
      getPosts: () => Effect.succeed(posts),
    }))
    const error = yield* getUserProfileEffect(1).pipe(Effect.provide(Banned), Effect.flip)
    expect(error._tag).toBe("UserBannedError")
  }))

  it.effect("fails with a typed NotFoundError", () =>
    Effect.gen(function*() {
      const error = yield* getUserProfileEffect(2).pipe(Effect.provide(FakeRepo), Effect.flip)
      expect(error._tag).toBe("NotFoundError")
    }))
})
