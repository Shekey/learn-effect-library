// ─────────────────────────────────────────────────────────────────────────────
// THE API CONTRACT. Define it once; Effect derives three things from it:
//   1. the SERVER: HttpApiBuilder.group(...) forces you to implement every endpoint with the right types
//      (api/TodosApiLive.ts). Forget one, or return the wrong shape, and it does not compile.
//   2. the CLIENT: HttpApiClient.make(TodosApi) / AtomHttpApi give a typed `client.todos.create({ payload })`
//      that validates responses and turns 404 bodies back into `TodoNotFound` (lesson 18, app/todos).
//   3. the DOCS: OpenAPI JSON at /api/v2/openapi.json and an interactive UI at /api/v2/docs.
//
// PROBLEM it solves: in a regular Next.js app the route, the fetch wrapper, the response type and the docs
//   are four hand-written things. Nothing checks that they agree.
// DON'T: put handler logic here. This file is pure description and is imported by the browser bundle.
// ─────────────────────────────────────────────────────────────────────────────
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { TodoNotFound } from "../domain/errors"
import { CreateTodo, Todo, TodoId } from "../domain/todo"

export class TodosGroup extends HttpApiGroup.make("todos")
  .add(
    HttpApiEndpoint.get("list", "/", {
      success: Schema.Array(Todo),
    }),
    HttpApiEndpoint.get("getById", "/:id", {
      // "/todos/abc" fails decoding -> automatic 400. "/todos/42" arrives as a TodoId (a number, not a string).
      params: { id: TodoId },
      success: Todo,
      error: TodoNotFound,
    }),
    HttpApiEndpoint.post("create", "/", {
      // The body is validated BEFORE the handler runs: an empty title never reaches your code.
      payload: CreateTodo,
      success: Todo,
    }),
    HttpApiEndpoint.patch("toggle", "/:id/toggle", {
      params: { id: TodoId },
      success: Todo,
      error: TodoNotFound,
    }),
  )
  .prefix("/todos")
  .annotateMerge(OpenApi.annotations({ title: "Todos", description: "A tiny CRUD API, fully typed end to end" })) {}

// The whole API mounts under /api/v2 because Next.js serves it from src/app/api/v2/[...path]/route.ts.
export class TodosApi extends HttpApi.make("todos-api")
  .add(TodosGroup)
  .prefix("/api/v2")
  .annotateMerge(OpenApi.annotations({ title: "learn-effect Todos API" })) {}
