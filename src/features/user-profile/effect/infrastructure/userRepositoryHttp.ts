import { Effect, Layer, Schema } from "effect"
import { UserRepository } from "../domain/userRepository"
import { UpstreamHttp } from "./upstreamHttp"
import { PostFromWire, UserFromWire } from "./wireSchemas"

// ─────────────────────────────────────────────────────────────────────────────
// This Layer is the ADAPTER for the UserRepository PORT (hexagonal / clean architecture):
//   domain/userRepository.ts  = what the app needs  (interface)
//   this file                 = how we get it       (HTTP)
// Swap it for an in-memory or DB version without touching application/ or domain/.
// Note: this file no longer knows about retries/timeouts/HTTP details; `UpstreamHttp` owns those.
// ─────────────────────────────────────────────────────────────────────────────
export const UserRepositoryHttp = Layer.effect(
  UserRepository,
  Effect.gen(function*() {
    // WHY yield*: ask the environment for the UpstreamHttp service (a typed dependency).
    const http = yield* UpstreamHttp

    return UserRepository.of({
      getUser: (id) => http.getJson(`/api/upstream/users/${id}`, UserFromWire),
      getPosts: (id) => http.getJson(`/api/upstream/users/${id}/posts`, Schema.Array(PostFromWire)),
    })
  }),
)
