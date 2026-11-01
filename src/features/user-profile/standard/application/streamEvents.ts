// PROBLEM: stream a paginated upstream to the client without loading everything.
// STANDARD WAY: an async generator + a ReadableStream. It works, but YOU must remember:
//   - pull() gives backpressure (good), but cancel() must abort the in-flight fetch yourself,
//   - errors in the middle of the stream surface as a broken response; no typed error channel,
//   - retries/timeouts per page are your job again (none here),
//   - the generator and the stream are two protocols to keep consistent.
// DON'T: `const all = []; while (cursor !== null) all.push(...await fetchPage())`. That's the memory bomb.
export function streamEvents(baseUrl: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const controller = new AbortController()

  async function* events() {
    let cursor: number | null = 0
    while (cursor !== null) {
      const res: Response = await fetch(`${baseUrl}/api/upstream/events?cursor=${cursor}`, { signal: controller.signal })
      const page = (await res.json()) as { items: { id: number; title: string }[]; next: number | null }
      for (const item of page.items) yield JSON.stringify(item) + "\n"
      cursor = page.next
    }
  }

  const iterator = events()
  return new ReadableStream<Uint8Array>({
    async pull(c) {
      const { value, done } = await iterator.next()
      if (done) c.close()
      else c.enqueue(encoder.encode(value))
    },
    cancel() {
      controller.abort() // forget this and the upstream keeps being fetched after the client left
    },
  })
}
