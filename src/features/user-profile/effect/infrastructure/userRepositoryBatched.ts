import { Effect, Exit, Layer, Request, RequestResolver, Schema } from "effect"
import type { Post, User } from "../../domain/profile"
import { NotFoundError } from "../domain/errors"
import { type RepoError, UserRepository } from "../domain/userRepository"
import { UpstreamHttp } from "./upstreamHttp"
import { PostFromWire, UserFromWire } from "./wireSchemas"

// ─────────────────────────────────────────────────────────────────────────────
// PROBLEM (the classic N+1): to build 4 profiles we call getUser(id) + getPosts(id) per id = 8 HTTP calls,
//   and duplicates (id 1 twice) are fetched twice. A GraphQL/DataLoader-style fix in plain TS means writing
//   a queue, a timer to collect calls, dedupe, fan-out of results, per-key errors... for EVERY resource.
//
// EFFECT WAY: describe each lookup as a *Request* (data), and give Effect a *Resolver* that knows how to
//   answer MANY requests with ONE call. Callers keep writing `repo.getUser(id)` as if it were single.
//   Effect collects all requests made in the same tick-window (setDelay) and hands them to the resolver.
//
// KEY IDEA: the use case did NOT change. Batching is an infrastructure concern, so it lives here.
// DON'T: batch by hand in the use case (`getUsers(ids)` leaking into the domain port). That couples
//        business logic to a transport optimization.
// ─────────────────────────────────────────────────────────────────────────────

// A Request is just typed data: "what do I want" + success type + error type.
class GetUser extends Request.Class<{ readonly id: number }, User, RepoError> {}
class GetPosts extends Request.Class<{ readonly userId: number }, readonly Post[], RepoError> {}

export const UserRepositoryBatched = Layer.effect(
  UserRepository,
  Effect.gen(function*() {
    const http = yield* UpstreamHttp

    // The resolver receives ALL collected requests ("entries") in one call. We make ONE HTTP request,
    // then complete every entry individually with success or its own failure.
    const users = RequestResolver.make<GetUser>(
      Effect.fn("UserResolver.batch")(function*(entries) {
        const ids = [...new Set(entries.map((e) => e.request.id))] // dedupe: 1,2,1,3 -> 1,2,3
        yield* Effect.annotateCurrentSpan({ batchSize: entries.length, uniqueIds: ids.length })
        // `Effect.exit` turns success/failure into a plain value, so ONE failed call can fail all entries
        // without crashing the resolver itself.
        const exit = yield* http.getJson(`/api/upstream/users?ids=${ids.join(",")}`, Schema.Array(UserFromWire)).pipe(
          Effect.exit,
        )
        for (const entry of entries) {
          if (Exit.isFailure(exit)) {
            entry.completeUnsafe(Exit.failCause(exit.cause))
            continue
          }
          const user = exit.value.find((u) => u.id === entry.request.id)
          entry.completeUnsafe(user ? Exit.succeed(user) : Exit.fail(new NotFoundError({ resource: `user ${entry.request.id}` })))
        }
      }),
    ).pipe(
      // Wait 10ms so concurrent callers can join the same batch. Trade-off: +10ms latency for the first caller.
      RequestResolver.setDelay("10 millis"),
      RequestResolver.withSpan("UserResolver"),
    )

    const posts = RequestResolver.make<GetPosts>(
      Effect.fn("PostResolver.batch")(function*(entries) {
        const ids = [...new Set(entries.map((e) => e.request.userId))]
        const exit = yield* http.getJson(`/api/upstream/posts?userIds=${ids.join(",")}`, Schema.Array(PostFromWire)).pipe(
          Effect.exit,
        )
        for (const entry of entries) {
          entry.completeUnsafe(
            Exit.isFailure(exit)
              ? Exit.failCause(exit.cause)
              : Exit.succeed(exit.value.filter((p) => p.userId === entry.request.userId)),
          )
        }
      }),
    ).pipe(RequestResolver.setDelay("10 millis"), RequestResolver.withSpan("PostResolver"))

    // Effect.request(request, resolver) = "run this request through that resolver".
    // It looks like a single call, but is silently batched with its neighbours.
    return UserRepository.of({
      getUser: (id) => Effect.request(new GetUser({ id }), users),
      getPosts: (userId) => Effect.request(new GetPosts({ userId }), posts),
    })
  }),
)
