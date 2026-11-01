import { Context, type Effect } from "effect"
import type { Post, User } from "../../domain/profile"
import type { InvalidResponseError, NotFoundError, UpstreamError } from "./errors"
import type { TimeoutError } from "effect/Cause"

export type RepoError = NotFoundError | UpstreamError | InvalidResponseError | TimeoutError

// PORT (domain layer): WHAT the application needs, with no knowledge of HTTP, DB or caching.
// `Context.Service<Self, Shape>()("key")` declares a service: the class is both the TYPE and the LOOKUP KEY.
// Failures are part of every method's type (RepoError), so callers must deal with them.
// Implementations are Layers in infrastructure/ (Http, Batched, Cached), wired once in runtime.ts.
export class UserRepository extends Context.Service<UserRepository, {
  getUser(id: number): Effect.Effect<User, RepoError>
  getPosts(id: number): Effect.Effect<readonly Post[], RepoError>
}>()("user-profile/UserRepository") {}
