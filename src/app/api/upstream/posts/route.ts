import { chaos } from "@/features/fake-upstream/chaos"

// BATCH endpoint: GET /api/upstream/posts?userIds=1,2,3 -> posts of all those users in ONE request.
export async function GET(req: Request) {
  const ids = (new URL(req.url).searchParams.get("userIds") ?? "").split(",").map(Number).filter(Number.isInteger)
  const failure = await chaos(`/posts?userIds=${ids.join(",")}`, ids.includes(13) ? 13 : 0) // id 13 hangs, even inside a batch
  if (failure) return failure
  return Response.json(
    ids.flatMap((id) =>
      Array.from({ length: (id % 4) + 1 }, (_, i) => ({ post_id: i + 1, author_id: id, title: `Post ${i + 1}` })),
    ),
  )
}
