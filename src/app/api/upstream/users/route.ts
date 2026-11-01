import { chaos } from "@/features/fake-upstream/chaos"

// BATCH endpoint: GET /api/upstream/users?ids=1,2,3 -> all users in ONE request.
// Unknown ids (999) are simply missing from the result; the client decides what "missing" means.
export async function GET(req: Request) {
  const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").map(Number).filter(Number.isInteger)
  const failure = await chaos(`/users?ids=${ids.join(",")}`, ids.includes(13) ? 13 : 0) // id 13 hangs, even inside a batch
  if (failure) return failure
  return Response.json(
    ids.filter((id) => id !== 999).map((id) => ({ user_id: id, full_name: ` user ${id} `, state: id % 5 === 0 ? "B" : "A" })),
  )
}
