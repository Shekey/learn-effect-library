// ─────────────────────────────────────────────────────────────────────────────
// PROBLEM: the import pipeline needs "somewhere to put rows", but should not care whether that is Postgres,
//   a file, or (here) memory.
// EFFECT WAY: a small service with ONE batch method. The pipeline calls `insertBatch(rows)` once per
//   groupedWithin batch, i.e. one round trip per 100 rows instead of 100 round trips.
// DON'T: insert row by row from inside the parser. That couples parsing to storage and is N times slower.
// ─────────────────────────────────────────────────────────────────────────────
import { Context, Effect, Layer, Ref } from "effect"
import type { ContactRow } from "./domain"

export class RowSink extends Context.Service<RowSink, {
  insertBatch(rows: ReadonlyArray<ContactRow>): Effect.Effect<void>
  readonly all: Effect.Effect<ReadonlyArray<ContactRow>>
}>()("csv-import/RowSink") {
  /** In-memory adapter: good enough for a demo and for tests. A SQL adapter would do one multi-row INSERT. */
  static readonly memory = Layer.effect(
    RowSink,
    Effect.gen(function*() {
      const store = yield* Ref.make<ReadonlyArray<ContactRow>>([])
      return RowSink.of({
        // the sleep pretends to be a DB round trip, so the progress events are visible in the UI
        insertBatch: (rows) => Effect.sleep("20 millis").pipe(Effect.andThen(Ref.update(store, (all) => [...all, ...rows]))),
        all: Ref.get(store),
      })
    }),
  )
}
