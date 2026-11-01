// ─────────────────────────────────────────────────────────────────────────────
// PROBLEM: import a CSV upload that may be huge. Regular way: `await req.text()`, `split("\n")`, loop, insert
//   row by row. The whole file sits in memory, a bad row throws halfway, nothing reports progress, and if the
//   user closes the tab the loop keeps inserting.
// EFFECT WAY (the lesson 24 toolbox, for real):
//   bytes ─decodeText─▶ text ─splitLines─▶ lines ─drop header─▶ validate (Schema) ─┬─ ok ──groupedWithin──▶ insertBatch
//                                                                                 └─ bad ─▶ RowRejected event
//   The output is a Stream of progress events; the route turns it into SSE. Pull-based end to end: we only
//   read more of the upload when the DB has accepted the previous batch (backpressure, lesson 23). If the
//   client disconnects, the stream is interrupted and the upload stops being read.
// DON'T: Stream.runCollect the lines "to count them first". That brings the whole file back into memory.
// ─────────────────────────────────────────────────────────────────────────────
import { type Duration, Effect, Result, Schema, Stream } from "effect"
import { ContactRow, type ImportEvent } from "./domain"
import { RowSink } from "./rowSink"

export interface ImportOptions {
  /** "100 rows or 1 second, whichever comes first" */
  readonly batchSize?: number
  readonly batchWindow?: Duration.Input
}

const decodeRow = Schema.decodeUnknownEffect(ContactRow)

const parseLine = (line: string, lineNo: number) => {
  const [name = "", email = "", age = ""] = line.split(",").map((cell) => cell.trim())
  return decodeRow({ name, email, age }).pipe(
    Effect.mapError((e) => ({ line: lineNo, reason: e.message.split("\n")[0] })),
    Effect.result, // keep bad rows as values: one bad row must not abort the whole import
  )
}

export const importCsv = (
  bytes: Stream.Stream<Uint8Array, Error>,
  { batchSize = 100, batchWindow = "1 second" }: ImportOptions = {},
): Stream.Stream<ImportEvent, Error, RowSink> =>
  Stream.unwrap(Effect.gen(function*() {
    const sink = yield* RowSink
    let inserted = 0
    let rejected = 0

    const validated = bytes.pipe(
      Stream.decodeText,
      Stream.splitLines,
      Stream.zipWithIndex,
      Stream.drop(1), // header
      Stream.filter(([line]) => line.trim() !== ""),
      Stream.mapEffect(([line, i]) => parseLine(line, i + 1)),
    )

    // broadcast would also work here (two consumers of one source); partitioning by Result keeps it simple:
    // good rows are batched, bad rows become events right away, and both go out in source order.
    const events = validated.pipe(
      Stream.groupedWithin(batchSize, batchWindow),
      Stream.mapEffect((group) =>
        Effect.gen(function*() {
          const good = group.filter(Result.isSuccess).map((r) => r.success)
          const bad = group.filter(Result.isFailure).map((r) => r.failure)
          const out: Array<ImportEvent> = bad.map((b) => {
            rejected++
            return { _tag: "RowRejected", line: b.line, reason: b.reason }
          })
          if (good.length > 0) {
            yield* sink.insertBatch(good)
            inserted += good.length
            out.push({ _tag: "BatchInserted", size: good.length, inserted })
          }
          return out
        })
      ),
      Stream.flatMap((out) => Stream.fromIterable(out)),
    )

    return events.pipe(
      Stream.concat(Stream.suspend(() => Stream.succeed<ImportEvent>({ _tag: "Done", inserted, rejected }))),
    )
  }))
