import { streamEvents } from "@/features/user-profile/standard/application/streamEvents"

export async function GET() {
  return new Response(streamEvents(process.env.UPSTREAM_URL ?? "http://localhost:3000"), {
    headers: { "content-type": "application/x-ndjson" },
  })
}
