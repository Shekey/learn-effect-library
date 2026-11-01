"use client"

import { Suspense, use, useState } from "react"
import { fetchOutcome, profilesUrl, type Outcome } from "./api"

type Batch = { results: { id: number; profile?: unknown; error?: string }[]; upstreamCalls: number }

// NotFound / Banned are EXPECTED business outcomes (the use case handled them correctly): amber, not red.
// Red is reserved for unexpected failures, e.g. the upstream kept failing until the retries ran out.
const EXPECTED = new Set(["NotFoundError", "UserBannedError"])
const explain: Record<string, string> = {
  NotFoundError: "expected: this user does not exist (404)",
  UserBannedError: "expected: the business rule rejects banned users",
}

function Chips({ results }: { results: Batch["results"] }) {
  return (
    <div className="chips">
      {results.map((r, i) => (
        <span key={i} title={r.error ? explain[r.error] ?? "unexpected: upstream failed after all retries" : "profile built"}
          className={`chip ${!r.error ? "ok" : EXPECTED.has(r.error) ? "expected" : "err"}`}>{r.id}: {r.error ?? "ok"}</span>
      ))}
    </div>
  )
}

function Result({ std, eff, idCount }: { std: Promise<Outcome>; eff: Promise<Outcome>; idCount: number }) {
  const s = (use(std).body as Batch) ?? { results: [], upstreamCalls: 0 }
  const e = (use(eff).body as Batch) ?? { results: [], upstreamCalls: 0 }
  const max = Math.max(s.upstreamCalls, e.upstreamCalls, 1)
  // Minimum calls if NOTHING ever failed:
  //   standard: every id (duplicates included) does 1 user call + 1 posts call
  //   effect:   all ids share 1 batched users call + 1 batched posts call (duplicates removed)
  const stdMin = idCount * 2
  const effMin = 2
  const extra = (actual: number, min: number) => Math.max(0, actual - min)
  const saved = s.upstreamCalls ? Math.round((1 - e.upstreamCalls / s.upstreamCalls) * 100) : 0
  return (
    <>
      <div className="callbar"><span className="label" style={{ color: "var(--std)" }}>Standard</span>
        <div className="track"><div className="fill std" style={{ width: `${(s.upstreamCalls / max) * 100}%` }}>{s.upstreamCalls} calls</div></div></div>
      <div className="callbar"><span className="label" style={{ color: "var(--eff)" }}>Effect</span>
        <div className="track"><div className="fill eff" style={{ width: `${(e.upstreamCalls / max) * 100}%` }}>{e.upstreamCalls} calls</div></div></div>
      <p style={{ margin: "8px 0" }}><b>{saved}% fewer upstream calls</b> for the same answers. <span style={{ color: "var(--muted)" }}>(Retries on random failures add noise; re-run to see the range.)</span></p>
      <div className="math">
        <b>Where do these numbers come from?</b>
        <table>
          <thead><tr><th></th><th>Standard</th><th>Effect</th></tr></thead>
          <tbody>
            <tr><td>Calls if nothing fails</td><td>{idCount} ids × 2 (user + posts) = {stdMin}</td><td>1 batched users + 1 batched posts = {effMin}</td></tr>
            <tr><td>Extra calls from retries (random 500s)</td><td>+{extra(s.upstreamCalls, stdMin)}</td><td>+{extra(e.upstreamCalls, effMin)}</td></tr>
            <tr><td>Calls the upstream actually received</td><td><b>{s.upstreamCalls}</b></td><td><b>{e.upstreamCalls}</b></td></tr>
          </tbody>
        </table>
        <p style={{ margin: "8px 0 0", color: "var(--muted)" }}>
          Why: standard does one request per id, so duplicates are fetched twice and every call can fail and retry on its own.
          Effect collects all concurrent lookups for ~10 ms, removes duplicate ids, and sends one request per resource type.
          Fewer requests also means fewer chances to hit a random failure. {e.upstreamCalls < effMin && "Effect made fewer calls than the minimum because its 5 s cache served some data. "}
          Ids 999 (not found) and 5 (banned) still cost calls: the business rules run after the data is fetched.
        </p>
      </div>
      <div className="chips" style={{ marginTop: 0, marginBottom: 8 }}>
        <span className="chip ok">green = profile built</span>
        <span className="chip expected">amber = expected business outcome (not found / banned)</span>
        <span className="chip err">red = unexpected: upstream failed after all retries</span>
      </div>
      <div className="grid2">
        <div><b>Standard results</b><Chips results={s.results} /></div>
        <div><b>Effect results</b><Chips results={e.results} /></div>
      </div>
    </>
  )
}

export function BatchDemo() {
  const [ids, setIds] = useState("1,2,1,3,999,5")
  const [limit, setLimit] = useState("")
  const [run, setRun] = useState<{ key: number; idCount: number; std: Promise<Outcome>; eff: Promise<Outcome> } | null>(null)

  // Sequential on purpose: the fake upstream's call counter is global, parallel runs would mix their counts.
  const start = () => {
    const std = fetchOutcome(profilesUrl("standard", ids))
    const eff = std.then(() => fetchOutcome(profilesUrl("effect", ids, limit)))
    setRun({ key: Date.now(), idCount: ids.split(",").filter(Boolean).length, std, eff })
  }

  return (
    <div className="card">
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <label>ids <input className="text" value={ids} onChange={(e) => setIds(e.target.value)} style={{ width: 200 }} /></label>
        <label>Effect concurrency <input className="text" placeholder="unbounded" value={limit} onChange={(e) => setLimit(e.target.value)} style={{ width: 110 }} /></label>
        <button className="run" onClick={start}>▶ Run both</button>
      </div>
      {run ? (
        <Suspense key={run.key} fallback={<div><div className="skel" style={{ height: 22, margin: "8px 0" }} /><div className="skel" style={{ height: 22, margin: "8px 0", width: "50%" }} /></div>}>
          <Result std={run.std} eff={run.eff} idCount={run.idCount} />
        </Suspense>
      ) : (
        <div className="empty">Press “Run both”. Ids repeat on purpose (1 appears twice).</div>
      )}
    </div>
  )
}
