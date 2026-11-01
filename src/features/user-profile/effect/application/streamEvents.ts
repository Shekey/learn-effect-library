import { Effect, Option, Schema, Stream } from "effect"
import { UpstreamHttp } from "../infrastructure/upstreamHttp"

const Page = Schema.Struct({
  items: Schema.Array(Schema.Struct({ id: Schema.Int, title: Schema.String })),
  next: Schema.NullOr(Schema.Int),
})

// ─────────────────────────────────────────────────────────────────────────────
// PROBLEM: an upstream has 1,000,000 events in pages. Loading them all (`pages.flat()`) blows memory and the
//   client sees nothing until the last page arrives. Hand-written streaming needs ReadableStream plumbing,
//   cancellation when the client leaves, and error propagation.
// EFFECT WAY: a Stream is a lazy, pull-based sequence of effects. It fetches page N+1 ONLY when the consumer
//   has taken page N (backpressure), stops if the consumer cancels (interruption), and carries typed errors.
// DON'T: collect into an array (`Stream.runCollect`) unless you really need everything in memory.
// ─────────────────────────────────────────────────────────────────────────────
export const streamEvents = Stream.paginate(
  0, // the first cursor
  // Given a cursor, return [values on this page, Option of the next cursor]. None = finished.
  Effect.fn("streamEvents.page")(function*(cursor: number) {
    // WHY yield*: `UpstreamHttp` is a service; yielding it asks the environment for it (dependency injection).
    const http = yield* UpstreamHttp
    const page = yield* http.getJson(`/api/upstream/events?cursor=${cursor}`, Page)
    return [page.items, page.next === null ? Option.none() : Option.some(page.next)] as const
  }),
)

// One JSON object per line, as bytes: exactly what a Response body needs.
export const eventsAsNdjson = streamEvents.pipe(
  Stream.map((event) => JSON.stringify(event) + "\n"),
  Stream.encodeText,
)
