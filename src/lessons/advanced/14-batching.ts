// LESSON 14 (advanced): Batching (the N+1 problem).
// The real version is in the app: effect/infrastructure/userRepositoryBatched.ts
//
// PROBLEM: 5 callers each ask for one user -> 5 queries. Fixing it by hand means a queue + a timer + dedupe +
//   sending each result back to the right caller.
// EFFECT WAY: callers keep asking for ONE item at a time. A RequestResolver receives all requests made in the
//   same window together, deduplicated, and answers each one.
//
// DON'T: add `getUsers(ids)` to your domain just for performance. Keep the port singular, batch below it.
import { Effect, Exit, Request, RequestResolver } from "effect"

const section = (title: string) => Effect.sync(() => console.log(`\n── ${title} ──`))

// ── The regular way ──────────────────────────────────────────────────────────
// A hand-rolled "DataLoader": collect ids for 5ms, then do one call, then resolve each caller's promise.
const makeRegularLoader = (batchFetch: (ids: Array<number>) => Promise<Map<number, string>>) => {
  let pending = new Map<number, Array<(name: string) => void>>()
  let timer: ReturnType<typeof setTimeout> | undefined

  const flush = async () => {
    const batch = pending
    pending = new Map()
    timer = undefined
    const results = await batchFetch([...batch.keys()])
    for (const [id, callers] of batch) for (const resolve of callers) resolve(results.get(id)!)
    // Not handled here: errors, rejecting callers, cancellation, max batch size...
  }

  return (id: number) =>
    new Promise<string>((resolve) => {
      pending.set(id, [...(pending.get(id) ?? []), resolve])
      timer ??= setTimeout(flush, 5)
    })
}

const regularWay = async () => {
  let calls = 0
  const load = makeRegularLoader(async (ids) => {
    calls++
    console.log(`  batch call with unique ids: [${ids}]`)
    return new Map(ids.map((id) => [id, `name-${id}`]))
  })
  const names = await Promise.all([1, 2, 1, 3, 2].map(load))
  console.log("names:", names, "| backend calls:", calls)
}

// ── The Effect way ───────────────────────────────────────────────────────────
// 1) Describe ONE request: input { id }, output string, no error.
class GetName extends Request.Class<{ readonly id: number }, string, never> {}

const effectWay = Effect.gen(function*() {
  let calls = 0

  // 2) The resolver gets every request made in the same 5ms window.
  const resolver = RequestResolver.make<GetName>((entries) =>
    Effect.sync(() => {
      calls++
      const uniqueIds = [...new Set(entries.map((entry) => entry.request.id))]
      console.log(`  batch call with ${entries.length} requests, unique ids: [${uniqueIds}]`)
      for (const entry of entries) entry.completeUnsafe(Exit.succeed(`name-${entry.request.id}`))
    })
  ).pipe(RequestResolver.setDelay("5 millis"))

  // 3) Callers still ask for one name at a time.
  const getName = (id: number) => Effect.request(new GetName({ id }), resolver)

  const names = yield* Effect.forEach([1, 2, 1, 3, 2], getName, { concurrency: "unbounded" })
  console.log("names:", names, "| backend calls:", calls)
})

export const main = Effect.gen(function*() {
  yield* section("regular way (hand-written loader)")
  yield* Effect.promise(regularWay)

  yield* section("Effect way (Request + RequestResolver)")
  yield* effectWay

  // YOUR TURN: change `concurrency: "unbounded"` to `concurrency: 1`. How many backend calls now? Why?
})
