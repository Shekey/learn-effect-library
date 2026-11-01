import { getProfiles } from "@/features/user-profile/standard/application/getProfiles"
import { httpUserClient } from "@/features/user-profile/standard/infrastructure/httpUserClient"
import { toProfileDto } from "@/features/user-profile/presentation/profileDto"
import { upstreamCalls } from "@/features/fake-upstream/chaos"

// GET /api/standard/profiles?ids=1,2,1,3 -> per-id result + how many requests the upstream received.
export async function GET(req: Request) {
  const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").map(Number).filter(Number.isInteger)
  const before = upstreamCalls()
  const results = await getProfiles(httpUserClient, ids)
  return Response.json({
    results: results.map((r) => ("profile" in r ? { id: r.id, profile: toProfileDto(r.profile) } : r)),
    upstreamCalls: upstreamCalls() - before, // N+1 (standard) vs batched (effect)
  })
}
