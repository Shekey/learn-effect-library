import { Effect, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { importCsv } from "../importCsv"
import { RowSink } from "../rowSink"

const csv = (text: string) => Stream.make(new TextEncoder().encode(text))

describe("importCsv", () => {
  it("batches valid rows, reports bad rows, ends with a summary", async () => {
    const text = "name,email,age\nAda,ada@x.io,36\nBob,not-an-email,20\n\nCy,cy@x.io,41\nDee,dee@x.io,-1\nEve,eve@x.io,22\n"
    const program = Effect.gen(function*() {
      const events = yield* Stream.runCollect(importCsv(csv(text), { batchSize: 2, batchWindow: "1 second" }))
      const stored = yield* (yield* RowSink).all
      return { events, stored }
    }).pipe(Effect.provide(RowSink.memory))

    const { events, stored } = await Effect.runPromise(program)
    expect(stored.map((r) => r.name)).toEqual(["Ada", "Cy", "Eve"])
    expect(stored[0].age).toBe(36)
    expect(events.filter((e) => e._tag === "RowRejected").map((e) => e.line)).toEqual([3, 6]) // physical file lines (header = 1, blank lines count)
    expect(events.at(-1)).toEqual({ _tag: "Done", inserted: 3, rejected: 2 })
  })
})
