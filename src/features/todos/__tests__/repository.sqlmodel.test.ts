// CONTRACT TEST for adapter #3 (Model.Class + SqlModel.makeRepository).
// The cases mirror repository.contract.test.ts (which doesn't export its suite). If the derived adapter ever
// disagrees with the hand-written ones, this fails. Skipped without DATABASE_URL; runs in a rolled-back transaction.
import { Effect, Layer, Schema } from "effect"
import { SqlClient } from "effect/sql"
import { describe, expect, it } from "vitest"
import { TodoId } from "../domain/todo"
import { TodoRepository } from "../domain/todoRepository"
import { MigrationsLive, PgLive } from "../infrastructure/todoRepositorySql"
import { TodoRepositorySqlModelNoDeps } from "../infrastructure/todoRepositorySqlModel"

class Rollback extends Schema.TaggedError<Rollback>()("Rollback", {}) {}

const PgRepo = TodoRepositorySqlModelNoDeps.pipe(
  Layer.provideMerge(MigrationsLive.pipe(Layer.provideMerge(PgLive))),
  Layer.orDie,
)
const run = <A, E>(test: Effect.Effect<A, E, TodoRepository>) =>
  Effect.runPromise(
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      yield* sql.withTransaction(test.pipe(Effect.andThen(Effect.fail(new Rollback())))).pipe(
        Effect.catchTag("Rollback", () => Effect.void),
      )
    }).pipe(Effect.provide(PgRepo), Effect.orDie),
  )

describe.skipIf(!process.env.DATABASE_URL)("TodoRepository contract: postgres (SqlModel)", () => {
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
