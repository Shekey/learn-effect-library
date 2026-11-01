import { Effect } from "effect"
import type { Profile } from "../../domain/profile"
import { getUserProfile } from "./getUserProfile"

export type ProfileResult =
  | { readonly id: number; readonly profile: Profile }
  | { readonly id: number; readonly error: string }

// PROBLEM: fetch many profiles; one bad id (404, banned) must not sink the others.
// EFFECT WAY: run getUserProfile for each id concurrently; `Effect.match` converts each outcome into plain data,
//   so the outer Effect cannot fail. Concurrency "unbounded" is what lets the batching resolver see all
//   requests at once (see infrastructure/userRepositoryBatched.ts). We do NOT mention batching here.
// WHY yield*: forEach returns an Effect of an array; yield* hands us the array.
// DON'T: `Promise.all(ids.map(...))` on top of Effects: you'd have to run each one yourself and lose interruption.
//
// CONCURRENCY CONTROL: 10,000 ids with "unbounded" = 10,000 simultaneous requests = you DoS your own upstream.
//   Pass a number (`concurrency: 5`) and Effect keeps at most 5 in flight, starts the next as one finishes, and
//   interrupts the rest if the caller goes away. Trade-off with batching: a bound of 5 also means batches of <= 5.
export const getProfiles = Effect.fn("getProfiles")(function*(
  ids: readonly number[],
  concurrency: number | "unbounded" = "unbounded",
) {
  return yield* Effect.forEach(
    ids,
    (id) =>
      getUserProfile(id).pipe(
        Effect.match({
          onSuccess: (profile): ProfileResult => ({ id, profile }),
          onFailure: (error): ProfileResult => ({ id, error: error._tag }),
        }),
      ),
    { concurrency },
  )
})
