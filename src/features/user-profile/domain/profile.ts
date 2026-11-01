// Pure domain: no framework, no IO, no Effect. Shared by both implementations.
export interface User {
  readonly id: number
  readonly name: string
  readonly status: "active" | "banned"
}

export interface Post {
  readonly id: number
  readonly userId: number
  readonly title: string
}

export interface Profile {
  readonly displayName: string
  readonly postCount: number
  readonly level: "newbie" | "pro"
}

// Rule 1: banned users have no viewable profile (each version turns a violation into its own error).
export const canViewProfile = (user: User): boolean => user.status === "active"

// Rule 2 (BFF-style aggregation): combine user + posts into one domain view.
export const toProfile = (user: User, posts: readonly Post[]): Profile => ({
  displayName: user.name.trim().toUpperCase(),
  postCount: posts.length,
  level: posts.length >= 3 ? "pro" : "newbie",
})
