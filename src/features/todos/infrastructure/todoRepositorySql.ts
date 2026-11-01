// ─────────────────────────────────────────────────────────────────────────────
// ADAPTER #2: TodoRepository backed by Postgres (`effect/sql` + `@effect/sql-pg`).
//
// PROBLEM (regular `pg`): `const { rows } = await pool.query("SELECT ...")` gives `any[]`. You cast with
//   `as Todo[]` and hope. Transactions mean BEGIN/COMMIT/ROLLBACK by hand plus passing the `client` object to
//   every function that must join the transaction. Forget once and that query silently runs OUTSIDE it.
// EFFECT WAY:
//   - sql`... ${value}` is a tagged template: values become $1, $2 parameters (no SQL injection, ever).
//   - SqlSchema.findAll/findOne DECODE rows with the Todo schema. A renamed column fails loudly, not later.
//   - sql.withTransaction(effect): every query inside `effect` joins the transaction automatically (the
//     connection travels in the fiber's context, not as a parameter). A failure or interruption rolls back.
// DON'T: build SQL with string concatenation, or put SqlError in the port's types (see todoRepository.ts).
// ─────────────────────────────────────────────────────────────────────────────
import { PgClient } from "@effect/sql-pg"
import { Config, Effect, Layer, Schema } from "effect"
import { Migrator, SqlClient, SqlError, SqlSchema } from "effect/sql"
import { TodoNotFound } from "../domain/errors"
import { Todo, TodoId } from "../domain/todo"
import { TodoRepository } from "../domain/todoRepository"
import { TodoMigrations } from "./migrations"

// Only needs a SqlClient: tests or lessons can point it at any database.
export const TodoRepositorySqlNoDeps = Layer.effect(
  TodoRepository,
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient

    // SqlSchema.findAll = run the query, then decode EVERY row with the Todo schema. Returns ReadonlyArray<Todo>.
    const listAll = SqlSchema.findAll({
      Request: Schema.Void,
      Result: Todo,
      execute: () => sql`SELECT id, title, completed FROM todos ORDER BY id`,
    })
    // findOne fails with NoSuchElementError when there is no row; we translate that into our domain error.
    const findOne = SqlSchema.findOne({
      Request: TodoId,
      Result: Todo,
      execute: (id) => sql`SELECT id, title, completed FROM todos WHERE id = ${id}`,
    })

    // Infrastructure failures (connection lost, bad row shape) become DEFECTS: they still show up in logs and
    // traces with full detail, but callers only have to handle TodoNotFound. catchTags is exhaustive-checked.
    type InfraError = SqlError.SqlError | Schema.SchemaError
    const orDieOnInfra = <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, Exclude<E, InfraError>, R> =>
      Effect.catchIf(
        self,
        (e): e is Extract<E, InfraError> => SqlError.isSqlError(e) || Schema.isSchemaError(e),
        Effect.die,
      ) as Effect.Effect<A, Exclude<E, InfraError>, R>

    const audit = (todoId: TodoId, action: string) =>
      sql`INSERT INTO todo_audit_log (todo_id, action) VALUES (${todoId}, ${action})`

    return TodoRepository.of({
      list: listAll().pipe(orDieOnInfra, Effect.withSpan("TodoRepositorySql.list")),
      findById: (id) =>
        findOne(id).pipe(
          Effect.catchTag("NoSuchElementError", () => Effect.fail(new TodoNotFound({ id }))),
          orDieOnInfra,
          Effect.withSpan("TodoRepositorySql.findById"),
        ),

      // TWO writes, ONE transaction: the todo and its audit row are saved together or not at all.
      // Notice `audit(...)` takes no `client`/`tx` argument, yet it runs inside the transaction.
      create: ({ title }) =>
        sql.withTransaction(
          Effect.gen(function*() {
            const rows = yield* sql`INSERT INTO todos (title) VALUES (${title}) RETURNING id, title, completed`
            const todo = yield* Schema.decodeUnknownEffect(Todo)(rows[0])
            yield* audit(todo.id, "created")
            return todo
          }),
        ).pipe(orDieOnInfra, Effect.withSpan("TodoRepositorySql.create")),

      toggle: (id) =>
        sql.withTransaction(
          Effect.gen(function*() {
            const rows = yield* sql`
              UPDATE todos SET completed = NOT completed WHERE id = ${id} RETURNING id, title, completed`
            if (rows.length === 0) return yield* new TodoNotFound({ id })
            yield* audit(id, "toggled")
            return yield* Schema.decodeUnknownEffect(Todo)(rows[0])
          }),
        ).pipe(orDieOnInfra, Effect.withSpan("TodoRepositorySql.toggle")),

      deleteCompleted: sql`DELETE FROM todos WHERE completed RETURNING id`.pipe(
        Effect.map((rows) => rows.length),
        orDieOnInfra,
        Effect.withSpan("TodoRepositorySql.deleteCompleted"),
      ),
    })
  }),
)

// The Postgres connection POOL is a scoped resource: opened when the layer is built, closed when the
// runtime is disposed (lesson 13). DATABASE_URL is read through Config, so a missing or malformed value fails
// at startup with a clear ConfigError, not on the first request. `Redacted` keeps the password out of logs.
export const PgLive = PgClient.layerConfig({ url: Config.Redacted("DATABASE_URL") })

// Runs pending migrations once, when the layer is built. Needs only a SqlClient.
export const MigrationsLive = Layer.effectDiscard(Migrator.make({})({ loader: TodoMigrations }))

// Fully wired: Postgres pool -> migrations -> repository. Requires nothing from the outside.
export const TodoRepositorySql = TodoRepositorySqlNoDeps.pipe(
  Layer.provide(MigrationsLive),
  Layer.provide(PgLive),
  Layer.orDie, // can't connect / can't migrate = the app can't work. Crash at startup, loudly.
)
