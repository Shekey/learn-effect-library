// LIVE FEED: Server-Sent Events from the TodoEvents PubSub. Each open browser tab is one more subscriber.
// A more specific route than [...path], so Next.js picks this file for /api/v2/events.
//
// When the tab closes, the ReadableStream is cancelled -> Effect interrupts the stream -> the PubSub
// subscription is removed. No manual `emitter.off(...)`, no leaked listeners.
//
// ERRORS:
// - Before streaming (e.g. the runtime/Layer fails to build): caught below -> a real 503 status.
// - During streaming (status 200 already sent): streamResponse sends `event: error\ndata: {...}` and closes,
//   so the client can tell "broken" from "finished". See src/lib/effect/streamResponse.ts.
import { Effect, Schema, Stream } from "effect"
import { TodoEvent, TodoEvents } from "@/features/todos/domain/todoEvents"
import { todosApp } from "@/features/todos/runtime"
import { streamResponse } from "@/lib/effect/streamResponse"

const encode = Schema.encodeSync(TodoEvent)

export async function GET(req: Request) {
  return todosApp.runtime
    .runPromise(
      Effect.gen(function*() {
        const events = yield* TodoEvents
        const frames = events.subscribe.pipe(
          // encodeSync throws on bad data; inside Stream.map that becomes a defect, which streamResponse
          // still turns into an error frame.
          Stream.map((event) => `data: ${JSON.stringify(encode(event))}\n\n`),
          // A comment line every 15s keeps proxies from closing an idle connection.
          Stream.merge(Stream.tick("15 seconds").pipe(Stream.map(() => ": keep-alive\n\n"))),
        )
        return yield* streamResponse(frames, {
          contentType: "text/event-stream",
          onError: () => ({ message: "Event feed failed" }),
        })
      }),
      { signal: req.signal },
    )
    // Setup failure (no bytes sent yet), so we CAN still pick the status code.
    // An abort (client gone) also rejects here; the response is never read, so that's harmless.
    .catch(() => Response.json({ error: "Event feed unavailable" }, { status: 503 }))
}
