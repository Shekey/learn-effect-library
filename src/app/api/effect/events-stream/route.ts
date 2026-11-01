import { Stream } from "effect"
import { streamEvents } from "@/features/user-profile/effect/application/streamEvents"
import { runHttp } from "@/features/user-profile/effect/runtime"
import { streamResponse } from "@/lib/effect/streamResponse"

// NDJSON stream of upstream events.
// streamResponse bridges Stream -> ReadableStream -> Response. When the client disconnects, the ReadableStream
// is cancelled and Effect INTERRUPTS the stream (including the page request in flight). No manual abort.
//
// Once bytes are flowing the status is already 200, so a mid-stream failure can't become a 502. Instead the
// LAST line is `{"error": {...}}` (trailer convention, see src/lib/effect/streamResponse.ts).
//
// DEMO: `?failAfter=3` forces an upstream failure after 3 events, so you can see the error trailer.
export async function GET(req: Request) {
  const failAfter = Number(new URL(req.url).searchParams.get("failAfter") ?? NaN)
  const events = Number.isInteger(failAfter)
    ? streamEvents.pipe(Stream.take(failAfter), Stream.concat(Stream.fail("forced failure (failAfter)")))
    : streamEvents

  return runHttp(
    streamResponse(events.pipe(Stream.map((event) => JSON.stringify(event) + "\n")), {
      contentType: "application/x-ndjson",
      // Don't leak internals to the client: a stable, small payload.
      onError: () => ({ message: "Upstream failed" }),
    }),
    req.signal,
  )
}
