import { canViewProfile, toProfile, type Profile } from "../../domain/profile"
import { UserBannedError } from "../domain/errors"
import type { UserClient } from "../domain/userClient"

// Dependencies passed by hand. Signature: Promise<Profile> -- errors are invisible.
// If getUser fails, the getPosts request keeps running in the background (Promise.all doesn't cancel).
export async function getUserProfile(client: UserClient, id: number): Promise<Profile> {
  const [user, posts] = await Promise.all([client.getUser(id), client.getPosts(id)])
  if (!canViewProfile(user)) throw new UserBannedError(`user ${id}`)
  return toProfile(user, posts)
}
