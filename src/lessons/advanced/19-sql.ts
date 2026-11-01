// LESSON 19 (advanced): SQL with effect/sql + Postgres. Typed rows, transactions, migrations, a Layer swap.
//
// Start Postgres first (Docker):   pnpm db:up        (stop: pnpm db:down, wipe: pnpm db:reset)
// Then:                            pnpm lesson 19    (reads DATABASE_URL from .env.local, see .env.example)
// Without DATABASE_URL it still runs, on the in-memory adapter, and tells you how to switch.
//
// PROBLEM (regular `pg`):
//   const { rows } = await pool.query("SELECT * FROM todos WHERE id = " + id)   // SQL injection, rows: any[]
//   const client = await pool.connect(); await client.query("BEGIN"); ... ROLLBACK in catch, release in finally,
//   and every function that should join the transaction needs `client` passed in.
// EFFECT WAY:
//   sql`SELECT ... WHERE id = ${id}`  -> always a bind parameter ($1). Interpolation CAN'T inject.
//   SqlSchema.findAll({ Result: Todo }) -> rows decoded with the schema; a renamed column fails loudly
//   sql.withTransaction(effect)       -> everything inside joins automatically; failure/interrupt = ROLLBACK
//   Migrator                          -> migrations are Effects, run once, recorded in effect_sql_migrations
// DON'T: catch SqlError everywhere. Decide once, in the adapter: here it becomes a defect (todoRepositorySql.ts).
//
// HAND-WRITTEN vs DERIVED (adapter #2 todoRepositorySql.ts vs adapter #3 todoRepositorySqlModel.ts):
//   | aspect              | hand-written sql`...`              | Model.Class + SqlModel.makeRepository     |
//   |---------------------|------------------------------------|-------------------------------------------|
//   | CRUD by id          | you write every INSERT/UPDATE      | derived: insert/update/findById/delete    |
//   | insert vs row shape | implied by the SQL text            | explicit variants (id not in `insert`)    |
//   | custom queries      | natural (NOT completed, joins)     | still need sql`...` next to the repo      |
//   | round trips         | one UPDATE ... RETURNING           | toggle = findById + update (two)          |
//   | learning value      | you see the SQL Postgres runs      | less code, more "magic"                   |
//   Pick DERIVED for boring single-table CRUD with many columns. Pick HAND-WRITTEN for set-based updates,
//   joins, reporting, or when every round trip counts. Mixing both in one adapter is normal (adapter #3 does).
import { Config, Effect, Layer, Option, Schema } from "effect"
import { SqlClient } from "effect/sql"
import { TodoRepository } from "../../features/todos/domain/todoRepository"
import { TodoRepositoryMemory } from "../../features/todos/infrastructure/todoRepositoryMemory"
import { MigrationsLive, PgLive, TodoRepositorySqlNoDeps } from "../../features/todos/infrastructure/todoRepositorySql"
import { TodoRepositorySqlModelNoDeps } from "../../features/todos/infrastructure/todoRepositorySqlModel"

const section = (title: string) => Effect.sync(() => console.log(`\n── ${title} ──`))

// ── The regular way (not executed: shown for comparison) ─────────────────────
const regularWay = Effect.sync(() =>
  console.log(`  const { rows } = await pool.query("SELECT * FROM todos WHERE title = '" + input + "'")
  // input = "x' OR '1'='1"  -> returns every row. rows is any[]; \`as Todo[]\` is a guess.
  const client = await pool.connect()
  try { await client.query("BEGIN"); await createTodo(client, ...); await audit(client, ...); await client.query("COMMIT") }
  catch (e) { await client.query("ROLLBACK"); throw e } finally { client.release() }`),
)

// ── The Effect way ───────────────────────────────────────────────────────────
class Oops extends Schema.TaggedError<Oops>()("Oops", {}) {}

// The SAME program for both adapters: it only knows the TodoRepository port.
const usingThePort = Effect.gen(function*() {
  const repo = yield* TodoRepository
  const todo = yield* repo.create({ title: "written through the port" })
  console.log("created:", todo)
  console.log("now", (yield* repo.list).length, "todos")
})

// Postgres-only demos: things a Map can't show you.
const postgresOnly = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  const repo = yield* TodoRepository

  // 1. Parameters, never string concatenation. compile() shows what is actually sent to Postgres.
  const evil = "x' OR '1'='1"
  const [text, params] = sql`SELECT id FROM todos WHERE title = ${evil}`.compile()
  console.log("SQL sent:", text, " params:", params)

  // 2. Transactions. The repository's `create` runs its OWN transaction (todo + audit row); here it is nested
  //    inside ours, so it becomes a SAVEPOINT. Then we fail on purpose: EVERYTHING rolls back.
  const before = (yield* repo.list).length
  yield* sql.withTransaction(
    Effect.gen(function*() {
      yield* repo.create({ title: "this will be rolled back" })
      console.log("inside the transaction:", (yield* repo.list).length, "todos")
      return yield* new Oops()
    }),
  ).pipe(Effect.catchTag("Oops", () => Effect.void))
  console.log(`after rollback: ${(yield* repo.list).length} todos (was ${before})`)

  // 3. The audit table written in the same transaction as each create/toggle.
  const audit = yield* sql`SELECT todo_id, action FROM todo_audit_log ORDER BY id DESC LIMIT 3`
  console.log("latest audit rows:", audit)
  console.log("Explore yourself: pnpm db:psql, then  \\dt   SELECT * FROM effect_sql_migrations;")
})

export const main = Effect.gen(function*() {
  yield* section("regular way (pg by hand)")
  yield* regularWay

  const url = yield* Config.option(Config.String("DATABASE_URL"))
  if (Option.isNone(url)) {
    yield* section("Effect way, in-memory adapter (DATABASE_URL is not set)")
    yield* usingThePort.pipe(Effect.provide(TodoRepositoryMemory))
    console.log("\nTo run against Postgres:  cp .env.example .env.local  &&  pnpm db:up  &&  pnpm lesson 19")
    return
  }

  // Repository + migrations + connection pool, and keep SqlClient visible for the demos (provideMerge).
  const PgRepo = TodoRepositorySqlNoDeps.pipe(
    Layer.provideMerge(MigrationsLive.pipe(Layer.provideMerge(PgLive))),
  )

  yield* section("Effect way, SAME program on Postgres (only the Layer changed)")
  yield* Effect.gen(function*() {
    yield* usingThePort
    yield* section("Postgres-only: parameters, nested transaction + rollback, audit log")
    yield* postgresOnly
  }).pipe(
    Effect.provide(PgRepo),
    Effect.catchTag("SqlError", (e) =>
      Effect.sync(() => console.log(`Could not reach Postgres (${e.message}). Did you run \`pnpm db:up\`?`))),
  )

  // Adapter #3: derived from a Model. SAME program, SAME port, only the Layer changed again.
  yield* section("Effect way, SAME program on the derived adapter (Model.Class + SqlModel.makeRepository)")
  yield* usingThePort.pipe(
    Effect.provide(TodoRepositorySqlModelNoDeps.pipe(Layer.provide(MigrationsLive.pipe(Layer.provideMerge(PgLive))))),
    Effect.catchTag("SqlError", (e) => Effect.sync(() => console.log(`Could not reach Postgres (${e.message}).`))),
  )
  // The pool is closed here automatically: PgLive is a scoped Layer (lesson 13).
})
