import { chaos } from "@/features/fake-upstream/chaos"

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id)
  const failure = await chaos(`/users/${id}/posts`, id)
  if (failure) return failure
  return Response.json(
    Array.from({ length: (id % 4) + 1 }, (_, i) => ({ post_id: i + 1, author_id: id, title: `Post ${i + 1}` })),
  )
}
