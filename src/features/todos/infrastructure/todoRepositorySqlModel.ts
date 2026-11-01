// ─────────────────────────────────────────────────────────────────────────────
// ADAPTER #3: TodoRepository backed by Postgres, built with `Model.Class` + `SqlModel.makeRepository`.
//
// PROBLEM (adapter #2, todoRepositorySql.ts): every INSERT/UPDATE/SELECT is written by hand. Great for learning
//   SQL, but for plain CRUD you repeat the column list in every query, and the "insert shape" (no id yet) and
//   the "row shape" (with id) are only implied by the SQL text.
// EFFECT WAY: describe the row ONCE with `Model.Class`. Each field says in which VARIANTS it exists
//   (select / insert / update / json / jsonCreate / jsonUpdate). `Model.FieldExcept(["insert", ...])` on the id = "Postgres makes
//   the id": it is in `select` and `update`, but NOT in `insert`. `SqlModel.makeRepository` then derives
//   insert / update / findById / delete, each encoding/decoding with the matching variant schema.
//   Anything that is not plain CRUD (list ordering, bulk delete) still uses the `sql` tag.
// DON'T: try to force every query through the derived repository. It covers single-row CRUD by id, nothing more.
//   And don't leak the Model to callers: the port speaks `Todo`, so we map at the edge.
// ─────────────────────────────────────────────────────────────────────────────
import { Effect, Layer, Schema } from "effect"
import { Model } from "effect/schema"
import { SqlClient, SqlError, SqlModel, SqlSchema } from "effect/sql"
import { TodoNotFound } from "../domain/errors"
import { Todo, TodoId } from "../domain/todo"
import { TodoRepository } from "../domain/todoRepository"
import { MigrationsLive, PgLive } from "./todoRepositorySql"

// The DB model. Same columns as the `todos` table (see migrations.ts).
export class TodoModel extends Model.Class<TodoModel>("TodoModel")({
  // Postgres makes the id, so it is NOT in `insert`; `update` needs it (WHERE id = ...), so we keep it there.
  // (Model.GeneratedByDb would also drop it from `update`, which makeRepository needs.)
  id: TodoId.pipe(Model.FieldExcept(["insert", "jsonCreate"])),
  title: Schema.String,
  completed: Schema.Boolean,
}) {}

const toTodo = (m: TodoModel) => new Todo({ id: m.id, title: m.title, completed: m.completed })

// Same policy as adapter #2: infrastructure failures become defects, only domain errors stay typed.
type InfraError = SqlError.SqlError | Schema.SchemaError
const orDieOnInfra = <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, Exclude<E, InfraError>, R> =>
  Effect.catchIf(
    self,
    (e): e is Extract<E, InfraError> => SqlError.isSqlError(e) || Schema.isSchemaError(e),
    Effect.die,
  ) as Effect.Effect<A, Exclude<E, InfraError>, R>

export const TodoRepositorySqlModelNoDeps = Layer.effect(
  TodoRepository,
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient

    // DERIVED: insert / update / findById / delete, no SQL written by us.
    const repo = yield* SqlModel.makeRepository(TodoModel, {
      tableName: "todos",
      spanPrefix: "TodoRepositorySqlModel",
      idColumn: "id",
    })

    // HAND-WRITTEN: the derived repo has no "list all" and no bulk delete.
    const listAll = SqlSchema.findAll({
      Request: Schema.Void,
      Result: TodoModel,
      execute: () => sql`SELECT id, title, completed FROM todos ORDER BY id`,
    })
    const audit = (todoId: TodoId, action: string) =>
      sql`INSERT INTO todo_audit_log (todo_id, action) VALUES (${todoId}, ${action})`

    const findById = (id: TodoId) =>
      repo.findById(id).pipe(Effect.catchTag("NoSuchElementError", () => Effect.fail(new TodoNotFound({ id }))))

    return TodoRepository.of({
      list: listAll().pipe(Effect.map((rows) => rows.map(toTodo)), orDieOnInfra),
      findById: (id) => findById(id).pipe(Effect.map(toTodo), orDieOnInfra),

      // `TodoModel.insert` has no `id` field: the type system stops you from inventing one.
      create: ({ title }) =>
        sql.withTransaction(
          Effect.gen(function*() {
            const created = yield* repo.insert(TodoModel.insert.make({ title, completed: false }))
            yield* audit(created.id, "created")
            return toTodo(created)
          }),
        ).pipe(orDieOnInfra, Effect.withSpan("TodoRepositorySqlModel.create")),

      // Read-modify-write: two round trips where adapter #2 needs one (`SET completed = NOT completed`).
      // That's the price of the derived update.
      toggle: (id) =>
        sql.withTransaction(
          Effect.gen(function*() {
            const current = yield* findById(id)
            const updated = yield* repo.update(
              TodoModel.update.make({ id, title: current.title, completed: !current.completed }),
            )
            yield* audit(id, "toggled")
            return toTodo(updated)
          }),
        ).pipe(orDieOnInfra, Effect.withSpan("TodoRepositorySqlModel.toggle")),

      deleteCompleted: sql`DELETE FROM todos WHERE completed RETURNING id`.pipe(
        Effect.map((rows) => rows.length),
        orDieOnInfra,
        Effect.withSpan("TodoRepositorySqlModel.deleteCompleted"),
      ),
    })
  }),
)

// Fully wired, same shape as TodoRepositorySql: swap one Layer and the app uses the derived adapter.
export const TodoRepositorySqlModel = TodoRepositorySqlModelNoDeps.pipe(
  Layer.provide(MigrationsLive),
  Layer.provide(PgLive),
  Layer.orDie,
)
