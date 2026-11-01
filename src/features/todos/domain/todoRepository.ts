import { Context, type Effect } from "effect"
import type { TodoNotFound } from "./errors"
import type { CreateTodo, Todo, TodoId } from "./todo"

// PORT: what the application needs from storage. No SQL, no Map, no HTTP in sight.
// Two adapters implement it (infrastructure/todoRepositoryMemory.ts and todoRepositorySql.ts).
// The SAME contract test (__tests__/repository.contract.test.ts) runs against both.
// Database errors are NOT in these types on purpose: a broken connection is a defect for the caller
// (it cannot do anything useful about it), so the SQL adapter turns SqlError into a defect with `orDie`.
export class TodoRepository extends Context.Service<TodoRepository, {
  readonly list: Effect.Effect<ReadonlyArray<Todo>>
  findById(id: TodoId): Effect.Effect<Todo, TodoNotFound>
  create(input: CreateTodo): Effect.Effect<Todo>
  toggle(id: TodoId): Effect.Effect<Todo, TodoNotFound>
  /** Deletes completed todos and returns how many were removed. Used by the scheduled cleanup job. */
  readonly deleteCompleted: Effect.Effect<number>
}>()("todos/TodoRepository") {}
