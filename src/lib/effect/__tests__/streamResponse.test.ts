import { Effect, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { streamResponse } from "../streamResponse"

const failHalfway = Stream.make("a", "b").pipe(Stream.concat(Stream.fail("boom" as const)))

describe("streamResponse", () => {
  it("NDJSON: a mid-stream failure ends with an error trailer line", async () => {
    const res = await Effect.runPromise(
      streamResponse(failHalfway.pipe(Stream.map((s) => JSON.stringify({ s }) + "\n")), {
        contentType: "application/x-ndjson",
        onError: () => ({ message: "Upstream" }),
      }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("application/x-ndjson")
    const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l))
    expect(lines).toEqual([{ s: "a" }, { s: "b" }, { error: { message: "Upstream" } }])
  })

  it("SSE: a mid-stream failure sends an `event: error` frame", async () => {
    const res = await Effect.runPromise(
      streamResponse(failHalfway.pipe(Stream.map((s) => `data: ${s}\n\n`)), { contentType: "text/event-stream" }),
    )
    expect(await res.text()).toBe(`data: a\n\ndata: b\n\nevent: error\ndata: {"message":"Stream failed"}\n\n`)
  })

  it("a successful stream has no error frame", async () => {
    const res = await Effect.runPromise(streamResponse(Stream.make("x\n"), { contentType: "application/x-ndjson" }))
    expect(await res.text()).toBe("x\n")
  })
})
