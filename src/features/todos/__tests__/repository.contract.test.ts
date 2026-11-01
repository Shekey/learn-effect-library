// CONTRACT TEST: one test suite, run against EVERY TodoRepository adapter.
// If the SQL adapter and the memory adapter ever disagree (ordering, not-found behaviour, toggling), this fails.
// That's what makes it safe to use the memory adapter in all other tests.
//
//   pnpm test        -> memory only (Postgres suite is skipped)
//   pnpm test:db     -> also runs against Postgres (needs `pnpm db:up`)
//
// Postgres tests run inside a transaction that is ALWAYS rolled back, so they never touch your dev data.
// The repository's own `sql.withTransaction` calls nest inside it as SAVEPOINTs automatically.
import { Effect, Layer, Schema } from "effect"
import { SqlClient } from "effect/sql"
import { describe, expect, it } from "vitest"
import { TodoId } from "../domain/todo"
import { TodoRepository } from "../domain/todoRepository"
import { TodoRepositoryMemory } from "../infrastructure/todoRepositoryMemory"
import { MigrationsLive, PgLive, TodoRepositorySqlNoDeps } from "../infrastructure/todoRepositorySql"

class Rollback extends Schema.TaggedError<Rollback>()("Rollback", {}) {}

const contract = (name: string, run: <A, E>(test: Effect.Effect<A, E, TodoRepository>) => Promise<unknown>) =>
  describe(`TodoRepository contract: ${name}`, () => {
    it("creates a todo that is open and listed", () =>
      run(Effect.gen(function*() {
        const repo = yield* TodoRepository
        const todo = yield* repo.create({ title: "contract" })
        expect(todo.completed).toBe(false)
        expect((yield* repo.list).map((t) => t.id)).toContain(todo.id)
      })))

    it("toggles back and forth", () =>
      run(Effect.gen(function*() {
        const repo = yield* TodoRepository
        const todo = yield* repo.create({ title: "toggle me" })
        expect((yield* repo.toggle(todo.id)).completed).toBe(true)
        expect((yield* repo.toggle(todo.id)).completed).toBe(false)
      })))

    it("fails with TodoNotFound for unknown ids (find and toggle)", () =>
      run(Effect.gen(function*() {
        const repo = yield* TodoRepository
        const missing = TodoId.make(987654)
        expect((yield* Effect.flip(repo.findById(missing)))._tag).toBe("TodoNotFound")
        expect((yield* Effect.flip(repo.toggle(missing)))._tag).toBe("TodoNotFound")
      })))

    it("deleteCompleted removes only completed todos", () =>
      run(Effect.gen(function*() {
        const repo = yield* TodoRepository
        const keep = yield* repo.create({ title: "keep" })
        const drop = yield* repo.create({ title: "drop" })
        yield* repo.toggle(drop.id)
        expect(yield* repo.deleteCompleted).toBeGreaterThanOrEqual(1)
        const ids = (yield* repo.list).map((t) => t.id)
        expect(ids).toContain(keep.id)
        expect(ids).not.toContain(drop.id)
      })))
  })

// Memory: a fresh layer per test.
contract("memory", (test) => Effect.runPromise(test.pipe(Effect.provide(TodoRepositoryMemory))))

// Postgres: only when DATABASE_URL is set.
const PgRepo = TodoRepositorySqlNoDeps.pipe(
  Layer.provideMerge(Layer.mergeAll(MigrationsLive).pipe(Layer.provideMerge(PgLive))),
  Layer.orDie,
)
const inRolledBackTransaction = <A, E>(test: Effect.Effect<A, E, TodoRepository>) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql.withTransaction(test.pipe(Effect.andThen(Effect.fail(new Rollback())))).pipe(
      Effect.catchTag("Rollback", () => Effect.void),
    )
  }).pipe(Effect.provide(PgRepo), Effect.orDie)

describe.skipIf(!process.env.DATABASE_URL)("postgres", () => {
  contract("postgres", (test) => Effect.runPromise(inRolledBackTransaction(test)))
})
