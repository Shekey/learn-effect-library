import { Effect } from "effect"
import { getUserProfile } from "@/features/user-profile/effect/application/getUserProfile"
import { toProfileDto } from "@/features/user-profile/presentation/profileDto"
import { runHttp } from "@/features/user-profile/effect/runtime"

// The route is a THIN adapter: parse input -> call the use case -> map the outcome to HTTP.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id)
  if (!Number.isInteger(id)) return Response.json({ error: "BadRequest" }, { status: 400 })

  return runHttp(
    // `pipe` = apply transformations to an Effect left-to-right. Nothing has RUN yet; it's all description.
    getUserProfile(id).pipe(
      Effect.map((profile) => Response.json(toProfileDto(profile))),
      // catchTags handles errors BY TAG. Remove a line and `runHttp` stops compiling: that is the safety net.
      // DON'T use a blanket `Effect.catch(() => ...)` here; it would hide new error types forever.
      Effect.catchTags({
        NotFoundError: () => Effect.succeed(Response.json({ error: "NotFound" }, { status: 404 })),
        UserBannedError: () => Effect.succeed(Response.json({ error: "UserBanned" }, { status: 403 })),
        TimeoutError: () => Effect.succeed(Response.json({ error: "Timeout" }, { status: 504 })),
        UpstreamError: () => Effect.succeed(Response.json({ error: "Upstream" }, { status: 502 })),
        InvalidResponseError: () => Effect.succeed(Response.json({ error: "Upstream" }, { status: 502 })),
      }),
    ),
    req.signal, // client disconnects -> the whole Effect (and its in-flight HTTP calls) is interrupted
  )
}
