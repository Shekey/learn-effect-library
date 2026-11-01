// Paginated upstream: 8 pages x 5 events. GET /api/upstream/events?cursor=0 -> { items, next }
const PAGE_SIZE = 5
const TOTAL = 40

export async function GET(req: Request) {
  const cursor = Number(new URL(req.url).searchParams.get("cursor") ?? 0)
  await new Promise((r) => setTimeout(r, 150)) // each page is slow, so streaming vs buffering is visible
  const items = Array.from({ length: Math.max(0, Math.min(PAGE_SIZE, TOTAL - cursor)) }, (_, i) => ({
    id: cursor + i + 1,
    title: `event ${cursor + i + 1}`,
  }))
  return Response.json({ items, next: cursor + PAGE_SIZE < TOTAL ? cursor + PAGE_SIZE : null })
}
