import { Effect, Stream } from "effect"
import { eventsAsNdjson } from "@/features/user-profile/effect/application/streamEvents"
import { runHttp } from "@/features/user-profile/effect/runtime"

export async function GET(req: Request) {
  return runHttp(
    // toReadableStreamEffect: Effect -> ReadableStream. When the client disconnects, the ReadableStream is
    // cancelled and Effect INTERRUPTS the stream (including the page request in flight). No manual abort.
    Stream.toReadableStreamEffect(eventsAsNdjson).pipe(
      Effect.map((body) => new Response(body, { headers: { "content-type": "application/x-ndjson" } })),
      // NOTE: once bytes are flowing the status is already 200, so a mid-stream failure can only end the body.
      // This catch only covers failures while *building* the response.
      Effect.catch(() => Effect.succeed(Response.json({ error: "Upstream" }, { status: 502 }))),
    ),
    req.signal,
  )
}
