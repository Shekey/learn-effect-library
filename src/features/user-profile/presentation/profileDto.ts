import type { Profile } from "../domain/profile"

// What the client gets. Deliberately different from the domain shape; the domain can change without breaking the API.
export interface ProfileDto {
  readonly name: string
  readonly posts: number
  readonly badge: string
}

export const toProfileDto = (profile: Profile): ProfileDto => ({
  name: profile.displayName,
  posts: profile.postCount,
  badge: profile.level === "pro" ? "⭐ pro" : "newbie",
})
