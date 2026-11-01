import type { Post, User } from "../../domain/profile"
import { InvalidResponseError, NotFoundError, TimeoutError, UpstreamError } from "../domain/errors"
import type { UserClient } from "../domain/userClient"

const BASE_URL = process.env.UPSTREAM_URL ?? "http://localhost:3000"
const TIMEOUT_MS = 1500
const MAX_RETRIES = 3

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Wire types, manual guards and manual mappers: three things to keep in sync by hand.
interface UserWire { user_id: number; full_name: string; state: "A" | "B" }
interface PostWire { post_id: number; author_id: number; title: string }

const isRecord = (u: unknown): u is Record<string, unknown> => typeof u === "object" && u !== null

const isUserWire = (u: unknown): u is UserWire =>
  isRecord(u) && Number.isInteger(u.user_id) && typeof u.full_name === "string" && u.full_name.length > 0 &&
  (u.state === "A" || u.state === "B")

const isPostWire = (p: unknown): p is PostWire =>
  isRecord(p) && Number.isInteger(p.post_id) && Number.isInteger(p.author_id) && typeof p.title === "string"

const toUser = (w: UserWire): User => ({ id: w.user_id, name: w.full_name, status: w.state === "A" ? "active" : "banned" })
const toPost = (w: PostWire): Post => ({ id: w.post_id, userId: w.author_id, title: w.title })

async function fetchOnce(path: string): Promise<unknown> {
  // Manual timeout plumbing.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE_URL}${path}`, { signal: controller.signal, cache: "no-store" })
    if (res.status === 404) throw new NotFoundError(path)
    if (!res.ok) throw new UpstreamError(`${path} -> ${res.status}`)
    return await res.json()
  } catch (e) {
    if (e instanceof NotFoundError || e instanceof UpstreamError) throw e
    if (e instanceof Error && e.name === "AbortError") throw new TimeoutError(path)
    throw new UpstreamError(String(e))
  } finally {
    clearTimeout(timer)
  }
}

// Manual retry loop with backoff; must remember not to retry 404s / timeouts.
async function getJson(path: string): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchOnce(path)
    } catch (e) {
      const retryable = e instanceof UpstreamError
      if (!retryable || attempt >= MAX_RETRIES) throw e
      await sleep(100 * 2 ** attempt)
    }
  }
}

export const httpUserClient: UserClient = {
  async getUser(id) {
    const json = await getJson(`/api/upstream/users/${id}`)
    if (!isUserWire(json)) throw new InvalidResponseError("user")
    return toUser(json)
  },
  async getPosts(id) {
    const json = await getJson(`/api/upstream/users/${id}/posts`)
    if (!Array.isArray(json) || !json.every(isPostWire)) throw new InvalidResponseError("posts")
    return json.map(toPost)
  },
}
