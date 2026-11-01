// LIVE FEED: Server-Sent Events from the TodoEvents PubSub. Each open browser tab is one more subscriber.
// A more specific route than [...path], so Next.js picks this file for /api/v2/events.
//
// When the tab closes, the ReadableStream is cancelled -> Effect interrupts the stream -> the PubSub
// subscription is removed. No manual `emitter.off(...)`, no leaked listeners.
import { Effect, Schema, Stream } from "effect"
import { TodoEvent, TodoEvents } from "@/features/todos/domain/todoEvents"
import { todosApp } from "@/features/todos/runtime"

const encode = Schema.encodeSync(TodoEvent)

export async function GET(req: Request) {
  return todosApp.runtime.runPromise(
    Effect.gen(function*() {
      const events = yield* TodoEvents
      const body = events.subscribe.pipe(
        Stream.map((event) => `data: ${JSON.stringify(encode(event))}\n\n`),
        // A comment line every 15s keeps proxies from closing an idle connection.
        Stream.merge(Stream.tick("15 seconds").pipe(Stream.map(() => ": keep-alive\n\n"))),
        Stream.encodeText,
      )
      const readable = yield* Stream.toReadableStreamEffect(body)
      return new Response(readable, {
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform" },
      })
    }),
    { signal: req.signal },
  )
}
