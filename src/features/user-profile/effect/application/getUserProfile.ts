import { Effect } from "effect"
import { canViewProfile, toProfile } from "../../domain/profile"
import { UserBannedError } from "../domain/errors"
import { UserRepository } from "../domain/userRepository"

// ─────────────────────────────────────────────────────────────────────────────
// THE USE CASE (application layer). Read this file first.
//
// Inferred type:
//   (id: number) => Effect<Profile, NotFound | Upstream | InvalidResponse | Timeout | UserBanned, UserRepository>
//                            ^ success   ^ every typed way it can fail                              ^ what it needs
//
// WHY Effect.fn("getUserProfile") and not Effect.gen inside an arrow function:
//   it is a reusable function, so Effect.fn gives it a tracing span (visible in Grafana) and better stack traces.
//
// WHY yield* on each line:
//   `yield* UserRepository`         -> ask the environment for the dependency (typed DI, no parameter threading)
//   `yield* Effect.all([...])`      -> run both calls and unwrap the results; if either fails the whole block
//                                      stops with that typed error and the sibling call is INTERRUPTED
//   `return yield* new BannedError` -> raise a typed failure (errors are yieldable). Always `return` it so
//                                      TypeScript knows nothing after it runs.
//
// WHAT'S MISSING ON PURPOSE: no try/catch, no retries, no timeouts, no HTTP, no JSON. Those are infrastructure
// concerns. This function reads like the business rule: fetch both, check the rule, build the profile.
// ─────────────────────────────────────────────────────────────────────────────
export const getUserProfile = Effect.fn("getUserProfile")(function*(id: number) {
  const repo = yield* UserRepository
  const [user, posts] = yield* Effect.all([repo.getUser(id), repo.getPosts(id)], { concurrency: "unbounded" })
  if (!canViewProfile(user)) return yield* new UserBannedError({ userId: id })
  return toProfile(user, posts)
})
