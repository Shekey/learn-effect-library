import type { Profile } from "../../domain/profile"
import type { UserClient } from "../domain/userClient"
import { getUserProfile } from "./getUserProfile"

export type ProfileResult =
  | { readonly id: number; readonly profile: Profile }
  | { readonly id: number; readonly error: string }

// PROBLEM (N+1): 4 ids -> 4 x (user + posts) = 8 upstream calls, and duplicate ids are fetched twice.
//
// FIXING IT in plain TS means building a "DataLoader": a queue per resource, a timer/microtask to collect keys,
// dedupe, one batched fetch, fan results back to each waiting promise, per-key errors, plus the cache.
// That is ~60 lines PER resource, rewritten for each project (or a dependency like `dataloader`), and the
// batching leaks into your application layer because the caller needs `getUsers(ids)` in the port.
//
// Below is the naive version on purpose: simple, readable, and slow. Compare with the Effect version, where
// the use case looks the same but infrastructure batches transparently.
export async function getProfiles(client: UserClient, ids: readonly number[]): Promise<ProfileResult[]> {
  return Promise.all(
    ids.map(async (id): Promise<ProfileResult> => {
      try {
        return { id, profile: await getUserProfile(client, id) }
      } catch (e) {
        // Error identity is lost: we only get `Error`. We fall back to the constructor name.
        return { id, error: e instanceof Error ? e.constructor.name : "Unknown" }
      }
    }),
  )
}
