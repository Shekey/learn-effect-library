// ─────────────────────────────────────────────────────────────────────────────
// SERVER SIDE of the contract. `HttpApiBuilder.group(TodosApi, "todos", ...)` hands you a `handlers` object
// that only accepts the endpoints declared in TodosApi.ts, with request types already decoded.
//
// Look at what is NOT here: no `await req.json()`, no `if (!body.title)`, no `parseInt(params.id)`, no
// `NextResponse.json(x, { status: 404 })`. The contract did all of that. Handlers are pure business logic.
//
// Try it: delete the `toggle` handler below -> compile error "missing toggle". Return `{ id: 1 }` from
// `create` -> compile error, `title` and `completed` are missing.
// ─────────────────────────────────────────────────────────────────────────────
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { TodoEvents } from "../domain/todoEvents"
import { TodoRepository } from "../domain/todoRepository"
import { TodosApi } from "./TodosApi"

// The handlers need TodoRepository + TodoEvents but do not say WHICH implementation. That is decided in
// infrastructure/runtime.ts (Postgres or memory) and in tests (always memory).
export const TodosApiLive = HttpApiBuilder.group(
  TodosApi,
  "todos",
  Effect.fn(function*(handlers) {
    const repo = yield* TodoRepository
    const events = yield* TodoEvents

    return handlers.handleAll({
      list: () => repo.list,
      // TodoNotFound flows out untouched; HttpApi turns it into a 404 because the error declares httpApiStatus.
      getById: ({ params }) => repo.findById(params.id),
      create: ({ payload }) =>
        repo.create(payload).pipe(
          // tap = "do this too, keep the original value". Publishing is fire-and-forget for the handler:
          // audit/notification/live-feed subscribers run on their own fibers (jobs/).
          Effect.tap((todo) => events.publish({ _tag: "TodoCreated", todo })),
        ),
      toggle: ({ params }) =>
        repo.toggle(params.id).pipe(Effect.tap((todo) => events.publish({ _tag: "TodoToggled", todo }))),
    })
  }),
)
