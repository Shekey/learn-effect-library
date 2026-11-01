import { chaos } from "@/features/fake-upstream/chaos"

// Fake external service. id 999 -> 404, id 13 -> hangs (timeout demo), otherwise random 500s.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id)
  const failure = await chaos(`/users/${id}`, id)
  if (failure) return failure
  // Wire format differs from our domain on purpose: snake_case + state codes ("A" active, "B" banned).
  return Response.json({ user_id: id, full_name: ` user ${id} `, state: id % 5 === 0 ? "B" : "A" })
}
