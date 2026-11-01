// PROBLEM: run `fn` over many items with at most `limit` in flight (don't hammer the upstream).
// STANDARD WAY: a small worker pool. Works, but notice what is NOT handled:
//   - if one worker throws, the OTHER workers keep going (no cancellation of siblings),
//   - there is no way to stop early if the caller disconnects,
//   - errors are plain `unknown`.
// (A library like `p-limit` solves the first part; Effect has it built in: `Effect.forEach(..., { concurrency: n })`.)
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
