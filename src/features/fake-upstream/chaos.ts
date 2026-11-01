// Fail rate is tunable: UPSTREAM_FAIL_RATE=0.6 pnpm dev
const FAIL_RATE = Number(process.env.UPSTREAM_FAIL_RATE ?? 0.4)

// Counts every request the fake upstream receives, so the UI can show "N+1 calls vs 1 batched call".
// On globalThis because Next may load each route in a separate module instance.
const g = globalThis as unknown as { __upstreamCalls?: number }
export const upstreamCalls = () => g.__upstreamCalls ?? 0

export async function chaos(label: string, id: number): Promise<Response | undefined> {
  g.__upstreamCalls = upstreamCalls() + 1
  if (id === 999) return Response.json({ error: "not found" }, { status: 404 })
  if (id === 13) await new Promise((r) => setTimeout(r, 10_000))
  await new Promise((r) => setTimeout(r, 50 + Math.random() * 150))
  const fail = Math.random() < FAIL_RATE
  console.log(`[upstream] ${label} -> ${fail ? 500 : 200}`)
  return fail ? Response.json({ error: "boom" }, { status: 500 }) : undefined
}
