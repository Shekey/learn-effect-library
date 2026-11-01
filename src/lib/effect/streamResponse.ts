// ─────────────────────────────────────────────────────────────────────────────
// streamResponse: Stream of text frames -> HTTP streaming Response (SSE or NDJSON).
//
// PROBLEM (regular way): every streaming route hand-rolls the same plumbing:
//   const readable = new ReadableStream({ start(controller) { ... enqueue ... } })
//   return new Response(readable, { headers: { "content-type": ... } })
// and when the upstream fails halfway, the body is simply cut off. The client sees "done" and
// cannot tell a finished stream apart from a broken one.
//
// WHY THE STATUS CODE CAN'T SAVE YOU: HTTP sends the status line and headers FIRST, before any body
// byte. Once the first frame is flushed the client already has "200 OK". There is no way to take it
// back and say "actually, 502". So a mid-stream failure must be reported IN THE BODY, using the
// stream format's own convention:
//   - SSE:    an `event: error` frame (EventSource / our client can listen for it), then close.
//   - NDJSON: a final line `{"error": {...}}`. CONVENTION (trailer): a line whose only key is
//             `error` is the LAST line and means "the stream broke". Readers must check for it.
//
// EFFECT WAY: the route builds a Stream<string, E, R> of already-formatted frames. This helper
//   1. catches any failure of that stream (typed error OR defect) and turns it into an error frame,
//   2. encodes text and bridges to a ReadableStream (client disconnect -> Effect interrupts the stream),
//   3. returns Effect<Response, never, R>, ready to hand to whichever runner the feature uses.
// It does NOT run anything itself: the caller passes the result to its own runtime (runHttp,
// todosApp.runtime.runPromise, ...). Keeps this file free of any app wiring.
//
// DON'T turn interruption into an error frame: interruption means the client went away, so there is
// nobody to send it to. Interrupt-only causes propagate untouched.
// ─────────────────────────────────────────────────────────────────────────────
import { Cause, Effect, Stream } from "effect"

export type StreamContentType = "text/event-stream" | "application/x-ndjson"

export interface StreamResponseOptions<E> {
  readonly contentType: StreamContentType
  /** Turn a mid-stream failure into a JSON-able payload for the error frame. Default: a generic message. */
  readonly onError?: (cause: Cause.Cause<E>) => unknown
  readonly headers?: Record<string, string>
}

/** Format an error payload as the final frame for the given content type. */
export const errorFrame = (contentType: StreamContentType, payload: unknown): string =>
  contentType === "text/event-stream"
    ? `event: error\ndata: ${JSON.stringify(payload)}\n\n`
    : `${JSON.stringify({ error: payload })}\n`

const defaultOnError = () => ({ message: "Stream failed" })

export const streamResponse = <E, R>(
  frames: Stream.Stream<string, E, R>,
  options: StreamResponseOptions<E>,
): Effect.Effect<Response, never, R> => {
  const onError = options.onError ?? defaultOnError
  const body = frames.pipe(
    Stream.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Stream.failCause(cause)
        : Stream.make(errorFrame(options.contentType, onError(cause)))
    ),
    Stream.encodeText,
  )
  return Stream.toReadableStreamEffect(body).pipe(
    Effect.map((readable) =>
      new Response(readable, {
        headers: {
          "content-type": options.contentType,
          ...(options.contentType === "text/event-stream" ? { "cache-control": "no-cache, no-transform" } : {}),
          ...options.headers,
        },
      })
    ),
  )
}
