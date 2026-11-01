// ─────────────────────────────────────────────────────────────────────────────
// MIGRATIONS as Effects. Keys are "<id>_<name>"; each runs ONCE, in id order, and is recorded in the
// `effect_sql_migrations` table. Run `pnpm db:psql` then `\dt` to see both tables.
//
// They run automatically when the SQL layer is built (see todoRepositorySql.ts), so `pnpm dev` and
// `pnpm lesson 19` always see an up-to-date schema. The migrator takes a Postgres advisory lock, so two
// app instances starting at the same time do not both run them.
// DON'T: edit a migration that already ran. Add a new one (0003_...) instead.
// ─────────────────────────────────────────────────────────────────────────────
import { Effect } from "effect"
import { Migrator, SqlClient } from "effect/sql"

export const TodoMigrations = Migrator.fromRecord({
  "0001_create_todos": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      CREATE TABLE todos (
        id         SERIAL PRIMARY KEY,
        title      TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
        completed  BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    yield* sql`INSERT INTO todos (title, completed) VALUES
      ('Read src/features/todos/infrastructure/todoRepositorySql.ts', true),
      ('Run pnpm db:psql and SELECT * FROM todos', false)`
  }),
  "0002_create_audit_log": Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      CREATE TABLE todo_audit_log (
        id         SERIAL PRIMARY KEY,
        todo_id    INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
        action     TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
  }),
})
