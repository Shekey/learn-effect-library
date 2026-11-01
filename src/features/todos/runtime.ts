// ─────────────────────────────────────────────────────────────────────────────
// COMPOSITION ROOT for the todos feature (same idea as user-profile/effect/runtime.ts, lesson 17).
// Read bottom-up:
//
//   TodoRepository  ── Postgres if DATABASE_URL is set, otherwise in-memory   (Layer.unwrap + Config)
//   TodoEvents      ── PubSub
//   Jobs            ── notification workers + cleanup schedule (need the two above + Notifier)
//   HTTP routes     ── HttpApi handlers + OpenAPI JSON + Scalar docs UI
//
// ONE ManagedRuntime owns all of it. The web handler shares the runtime's MemoMap, so the API handlers and the
// SSE route (app/api/v2/events) see the SAME PubSub and the SAME repository instance. Without the shared
// MemoMap each would build its own copy, and live events published by the API would never reach the feed.
// ─────────────────────────────────────────────────────────────────────────────
import { Config, Effect, Layer, ManagedRuntime, Option } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { makeAppSingleton } from "@/lib/effect/makeAppRuntime"
import { HttpApiBuilder, HttpApiScalar } from "effect/http-api"
import { TodosApi } from "./api/TodosApi"
import { TodosApiLive } from "./api/TodosApiLive"
import { TodoEvents } from "./domain/todoEvents"
import type { TodoRepository } from "./domain/todoRepository"
import { TodoRepositoryMemory } from "./infrastructure/todoRepositoryMemory"
import { TodoRepositorySql } from "./infrastructure/todoRepositorySql"
import { Notifier } from "./jobs/notifier"
import { CleanupJob, NotificationWorkers } from "./jobs/todoJobs"

// Choose the adapter from config. Business code never knows which one it got.
export const TodoRepositoryLive = Layer.unwrap(
  Effect.gen(function*() {
    const url = yield* Config.option(Config.String("DATABASE_URL"))
    if (Option.isSome(url)) {
      yield* Effect.logInfo("todos: using Postgres (DATABASE_URL is set)")
      return TodoRepositorySql
    }
    yield* Effect.logInfo("todos: using the in-memory repository (set DATABASE_URL to use Postgres)")
    return TodoRepositoryMemory
  }),
).pipe(Layer.orDie)

const CoreLive = Layer.mergeAll(TodoRepositoryLive, TodoEvents.layer)

// provideMerge: jobs need Repository + Events, and the result still EXPOSES them to the HTTP handlers.
export const TodosServicesLive = Layer.mergeAll(NotificationWorkers, CleanupJob).pipe(
  Layer.provide(Notifier.layerFlaky),
  Layer.provideMerge(CoreLive),
  Layer.orDie, // a bad TODO_CLEANUP_INTERVAL is a startup crash with a clear ConfigError, not a silent default
)

const RoutesLive = Layer.mergeAll(
  HttpApiBuilder.layer(TodosApi, { openapiPath: "/api/v2/openapi.json" }).pipe(Layer.provide(TodosApiLive)),
  HttpApiScalar.layer(TodosApi, { path: "/api/v2/docs" }),
).pipe(Layer.provide(TodosServicesLive), Layer.provide(HttpServer.layerServices))

type TodosServices = TodoRepository | TodoEvents
type Built = {
  runtime: ManagedRuntime.ManagedRuntime<TodosServices, never>
  web: { handler: (request: Request) => Promise<Response>; dispose: () => Promise<void> }
}

// Cached on globalThis for Next dev hot reload via makeAppSingleton (trade-off: src/lib/effect/makeAppRuntime.ts).
// When this wiring changes, the previous web handler AND runtime are disposed, so the old worker fibers and
// Postgres pool shut down instead of leaking. Web handler first: it borrows layers from the runtime's MemoMap.
const build = (): Built & { dispose: () => Promise<void> } => {
  const runtime = ManagedRuntime.make(TodosServicesLive)
  const web = HttpRouter.toWebHandler(RoutesLive, { memoMap: runtime.memoMap, disableLogger: true })
  return {
    runtime,
    web: { handler: (req) => web.handler(req), dispose: web.dispose },
    dispose: () => web.dispose().finally(() => runtime.dispose()),
  }
}
export const todosApp: Built = makeAppSingleton("todos", RoutesLive, build)
