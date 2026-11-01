import { toProfileDto } from "@/features/user-profile/presentation/profileDto"
import { getUserProfile } from "@/features/user-profile/standard/application/getUserProfile"
import {
  InvalidResponseError, NotFoundError, TimeoutError, UpstreamError, UserBannedError,
} from "@/features/user-profile/standard/domain/errors"
import { httpUserClient } from "@/features/user-profile/standard/infrastructure/httpUserClient"

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id)
  if (!Number.isInteger(id)) return Response.json({ error: "BadRequest" }, { status: 400 })

  try {
    return Response.json(toProfileDto(await getUserProfile(httpUserClient, id)))
  } catch (e) {
    // Nothing forces this chain to be complete; forget a case and it silently becomes a 500.
    if (e instanceof NotFoundError) return Response.json({ error: "NotFound" }, { status: 404 })
    if (e instanceof UserBannedError) return Response.json({ error: "UserBanned" }, { status: 403 })
    if (e instanceof TimeoutError) return Response.json({ error: "Timeout" }, { status: 504 })
    if (e instanceof UpstreamError || e instanceof InvalidResponseError) {
      return Response.json({ error: "Upstream" }, { status: 502 })
    }
    throw e
  }
}
