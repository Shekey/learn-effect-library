// POST /api/csv-import  (body: raw CSV bytes)  ->  text/event-stream of import progress.
//
// PROBLEM: `await req.text()` loads the whole upload, and the client sees nothing until it is all done.
// EFFECT WAY: req.body (a ReadableStream) becomes a Stream, flows through importCsv (lesson 24 toolbox), and
//   the progress Stream is turned back into a ReadableStream response. Abort the fetch -> the stream is
//   interrupted -> we stop reading the upload and stop inserting.
import { Stream } from "effect"
import { importCsv } from "@/features/csv-import/importCsv"
import { csvImportRuntime } from "@/features/csv-import/runtime"

export async function POST(req: Request) {
  const body = req.body
  if (!body) return Response.json({ error: "Empty body" }, { status: 400 })

  const bytes = Stream.fromReadableStream({
    evaluate: () => body,
    onError: (e) => (e instanceof Error ? e : new Error(String(e))),
  })

  const sse = importCsv(bytes, { batchSize: 100, batchWindow: "1 second" }).pipe(
    Stream.map((event) => `event: ${event._tag}\ndata: ${JSON.stringify(event)}\n\n`),
    // a failure after the 200 is sent can only be reported in-band
    Stream.catch((e) => Stream.make(`event: Failed\ndata: ${JSON.stringify({ reason: e.message })}\n\n`)),
    Stream.encodeText,
  )

  const stream = await csvImportRuntime.runPromise(Stream.toReadableStreamEffect(sse), { signal: req.signal })
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
  })
}
