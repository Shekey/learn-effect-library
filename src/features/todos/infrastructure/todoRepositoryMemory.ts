// ADAPTER #1: an in-memory TodoRepository. Used by tests, by lessons, and by `pnpm dev` when DATABASE_URL is not set.
// It is a Layer, so "swap the database for a Map" is a one-line change at the composition root, never an
// `if (process.env.NODE_ENV === "test")` inside business code.
import { Effect, Layer } from "effect"
import { TodoNotFound } from "../domain/errors"
import { Todo, TodoId } from "../domain/todo"
import { TodoRepository } from "../domain/todoRepository"

export const TodoRepositoryMemory = Layer.effect(
  TodoRepository,
  Effect.sync(() => {
    // State lives INSIDE the layer: every time the layer is built (each test, each runtime) you get a fresh Map.
    // No shared module-level state leaking between tests.
    const todos = new Map<TodoId, Todo>()
    let nextId = 1
    const insert = (title: string, completed = false) => {
      const todo = new Todo({ id: TodoId.make(nextId++), title, completed })
      todos.set(todo.id, todo)
      return todo
    }
    insert("Read src/features/todos/api/TodosApi.ts", true)
    insert("Open /api/v2/docs")

    const findById = (id: TodoId) =>
      Effect.suspend(() => {
        const todo = todos.get(id)
        return todo ? Effect.succeed(todo) : Effect.fail(new TodoNotFound({ id }))
      })

    return TodoRepository.of({
      list: Effect.sync(() => [...todos.values()]),
      findById,
      create: ({ title }) => Effect.sync(() => insert(title)),
      toggle: (id) =>
        findById(id).pipe(
          Effect.map((todo) => {
            const updated = new Todo({ ...todo, completed: !todo.completed })
            todos.set(id, updated)
            return updated
          }),
        ),
      deleteCompleted: Effect.sync(() => {
        let removed = 0
        for (const [id, todo] of todos) {
          if (todo.completed) {
            todos.delete(id)
            removed++
          }
        }
        return removed
      }),
    })
  }),
)
