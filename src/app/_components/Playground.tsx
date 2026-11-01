"use client"

import { useState } from "react"
import { fetchOutcome, profileUrl, type Outcome } from "./api"
import { ResultPanel, Verdict } from "./ResultPanel"
import { scenarios } from "./scenarios"

export function Playground() {
  const [selected, setSelected] = useState(scenarios[0])
  const [run, setRun] = useState<{ key: number; std: Promise<Outcome>; eff: Promise<Outcome>; both: Promise<[Outcome, Outcome]> } | null>(null)

  const start = () => {
    // Standard first, then Effect, so the shared in-memory upstream counters and logs stay readable.
    const std = fetchOutcome(profileUrl("standard", selected.id))
    const eff = fetchOutcome(profileUrl("effect", selected.id))
    setRun({ key: Date.now(), std, eff, both: Promise.all([std, eff]) })
  }
  const pick = (s: (typeof scenarios)[number]) => {
    setSelected(s)
    setRun(null)
  }

  return (
    <>
      <div className="scenarios">
        {scenarios.map((s) => (
          <button key={s.id} className="scenario" aria-pressed={s.id === selected.id} onClick={() => pick(s)}>
            <b>{s.title}</b>
            <small>{s.tagline}</small>
          </button>
        ))}
      </div>

      <div className="card explain">
        <div><span className="k">Testing</span><span>{selected.tests}</span></div>
        <div><span className="k">Watch for</span><span>{selected.watch}</span></div>
        <div><span className="k">Expected</span><span><span className="pill ok">HTTP {selected.expect}</span></span></div>
        <div><span className="k">Read code</span><span>{selected.files.map((f) => <code key={f} style={{ marginRight: 10 }}>{f}</code>)}</span></div>
        <div><button className="run" onClick={start}>▶ Run both</button></div>
      </div>

      <div className="grid2">
        <ResultPanel key={`s${run?.key}`} kind="std" title="Standard" subtitle="async/await, throw, manual retry" promise={run?.std ?? null} expect={selected.expect} />
        <ResultPanel key={`e${run?.key}`} kind="eff" title="Effect" subtitle="typed errors, Layers, HttpClient" promise={run?.eff ?? null} expect={selected.expect} />
      </div>
      <Verdict key={`v${run?.key}`} both={run?.both ?? null} />
    </>
  )
}
