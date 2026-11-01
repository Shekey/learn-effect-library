// Auth middleware over the full HTTP pipeline (HttpApiTest, in-memory). The client either sends the demo
// bearer token (via a client-side middleware Layer) or sends nothing, and we assert on the TYPED result.
import { Effect, Layer } from "effect"
import { HttpClientRequest, HttpServer } from "effect/http"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiTest } from "effect/http-api"
import { describe, expect, it } from "vitest"
import { Authorization, CurrentUser, DEMO_TOKEN, User } from "../api/auth"
import { TodosApi } from "../api/TodosApi"
import { TodosApiLive } from "../api/TodosApiLive"
import { TodoEvents } from "../domain/todoEvents"
import { TodoRepositoryMemory } from "../infrastructure/todoRepositoryMemory"

const ServerLayer = TodosApiLive.pipe(
  Layer.provide([TodoRepositoryMemory, TodoEvents.layer]),
  Layer.merge(HttpServer.layerServices),
)

// Client-side middleware: adds `Authorization: Bearer <token>` to every request.
const withToken = (token: string) =>
  HttpApiMiddleware.layerClient(Authorization, ({ next, request }) =>
    next(HttpClientRequest.bearerToken(request, token)))

const callMe = HttpApiTest.groups(TodosApi, ["todos"]).pipe(Effect.flatMap((client) => client.todos.me()))

describe("Authorization middleware", () => {
  it("returns the CurrentUser when the bearer token is valid", async () => {
    const user = await Effect.runPromise(
      callMe.pipe(Effect.scoped, Effect.provide(withToken(DEMO_TOKEN)), Effect.provide(ServerLayer)),
    )
    expect(user.name).toBe("Demo User")
  })

  it("turns a missing token into a typed 401 Unauthorized on the client", async () => {
    const error = await Effect.runPromise(callMe.pipe(Effect.flip, Effect.scoped, Effect.provide(ServerLayer)))
    expect(error._tag).toBe("Unauthorized")
  })

  it("rejects a wrong token with Unauthorized", async () => {
    const error = await Effect.runPromise(
      callMe.pipe(Effect.flip, Effect.scoped, Effect.provide(withToken("nope")), Effect.provide(ServerLayer)),
    )
    expect(error._tag).toBe("Unauthorized")
  })

  it("leaves public endpoints open (no token needed)", async () => {
    const todos = await Effect.runPromise(
      HttpApiTest.groups(TodosApi, ["todos"]).pipe(
        Effect.flatMap((client) => client.todos.list()),
        Effect.scoped,
        Effect.provide(ServerLayer),
      ),
    )
    expect(Array.isArray(todos)).toBe(true)
  })
})

// COMPILE-TIME acceptance check: a handler that uses CurrentUser on an endpoint WITHOUT the middleware leaves
// CurrentUser unsatisfied in the Layer's requirements. The @ts-expect-error fails tsc if that ever compiles.
class NoAuthApi extends HttpApi.make("no-auth").add(
  HttpApiGroup.make("g").add(HttpApiEndpoint.get("me", "/me", { success: User })),
) {}
const NoAuthLive = HttpApiBuilder.group(NoAuthApi, "g", (handlers) =>
  handlers.handle("me", () =>
    Effect.gen(function*() {
      return yield* CurrentUser
    })))
// @ts-expect-error CurrentUser is still required: nothing provides it without the middleware
export const noAuthCheck: Layer.Layer<Layer.Success<typeof NoAuthLive>, never, never> = NoAuthLive
