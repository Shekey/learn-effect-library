export type Kind = "standard" | "effect"
export type Outcome = { status: number; ms: number; body: unknown }

// Never rejects: failures become an Outcome with status 0. This keeps the Suspense `use(promise)` code simple.
export async function fetchOutcome(url: string): Promise<Outcome> {
  const start = performance.now()
  try {
    const res = await fetch(url, { cache: "no-store" })
    const body = await res.json().catch(() => null)
    return { status: res.status, ms: Math.round(performance.now() - start), body }
  } catch (e) {
    return { status: 0, ms: Math.round(performance.now() - start), body: { error: String(e) } }
  }
}

export const profileUrl = (kind: Kind, id: number) => `/api/${kind}/profile/${id}`
export const profilesUrl = (kind: Kind, ids: string, concurrency?: string) =>
  `/api/${kind}/profiles?ids=${encodeURIComponent(ids)}${kind === "effect" && concurrency ? `&concurrency=${concurrency}` : ""}`
