import { Effect } from "effect"
import { getProfiles } from "@/features/user-profile/effect/application/getProfiles"
import { runHttp } from "@/features/user-profile/effect/runtime"
import { toProfileDto } from "@/features/user-profile/presentation/profileDto"
import { upstreamCalls } from "@/features/fake-upstream/chaos"

// GET /api/effect/profiles?ids=1,2,1,3 -> per-id result + how many requests the upstream received.
export async function GET(req: Request) {
  const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").map(Number).filter(Number.isInteger)
  const limit = Number(new URL(req.url).searchParams.get("concurrency"))
  const before = upstreamCalls()
  return runHttp(
    // getProfiles cannot fail (errors were turned into data), so no catchTags is needed here.
    getProfiles(ids, limit > 0 ? limit : "unbounded").pipe(
      Effect.map((results) =>
        Response.json({
          results: results.map((r) => ("profile" in r ? { id: r.id, profile: toProfileDto(r.profile) } : r)),
          upstreamCalls: upstreamCalls() - before,
        })
      ),
    ),
    req.signal,
  )
}
