// ─────────────────────────────────────────────────────────────────────────────
// THE SINGLE SOURCE OF TRUTH for a todo. This file is imported by:
//   - the HTTP API contract (api/TodosApi.ts)        -> request/response validation + OpenAPI docs
//   - the SQL repository (infrastructure/*Sql.ts)    -> decoding rows coming out of Postgres
//   - the React page (app/todos)                     -> the typed client returns these exact types
//
// PROBLEM: in a regular stack you write the shape 3-4 times (TS interface, zod/yup for the body, a DTO mapper,
//          an OpenAPI yaml) and they drift apart. A renamed field compiles fine and breaks at runtime.
// EFFECT WAY: one Schema = TS type + runtime validator + encoder + OpenAPI schema. Change it here, and every
//          layer (server, client, DB decoding, docs) changes with it or fails to compile.
// DON'T: import server-only code (pg, node:*) here. This file ships to the browser too.
// ─────────────────────────────────────────────────────────────────────────────
import { Schema } from "effect"

// A branded number: a TodoId is a number at runtime, but you cannot pass a random `number` (e.g. a userId)
// where a TodoId is expected. Path params like "/todos/42" are decoded from string -> TodoId automatically.
export const TodoId = Schema.Int.pipe(Schema.brand("TodoId"))
export type TodoId = typeof TodoId.Type

export class Todo extends Schema.Class<Todo>("Todo")({
  id: TodoId,
  title: Schema.String,
  completed: Schema.Boolean,
}) {}

// What a client may SEND when creating a todo. Validation lives in the schema, so the server never sees
// an empty or 500-character title, and the OpenAPI docs show the same rules (minLength / maxLength).
export const CreateTodo = Schema.Struct({
  title: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
})
export type CreateTodo = typeof CreateTodo.Type
