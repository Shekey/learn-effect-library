"use client"

import { useRef, useState } from "react"
import type { Kind } from "./api"

type Line = { t: number; text: string }

function StreamPanel({ kind, title }: { kind: Kind; title: string }) {
  const [lines, setLines] = useState<Line[]>([])
  const [state, setState] = useState<"idle" | "running" | "done" | "cancelled">("idle")
  const [first, setFirst] = useState<number | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const ctl = useRef<AbortController | null>(null)

  async function start() {
    const controller = new AbortController()
    ctl.current = controller
    setLines([]); setFirst(null); setTotal(null); setState("running")
    const t0 = performance.now()
    try {
      const res = await fetch(`/api/${kind}/events-stream`, { cache: "no-store", signal: controller.signal })
      const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
      let buffer = ""
      let seenFirst = false
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += value
        const parts = buffer.split("\n")
        buffer = parts.pop() ?? ""
        const now = Math.round(performance.now() - t0)
        if (!seenFirst && parts.length) { seenFirst = true; setFirst(now) }
        setLines((l) => [...l, ...parts.map((text) => ({ t: now, text }))])
      }
      setTotal(Math.round(performance.now() - t0))
      setState("done")
    } catch {
      setState("cancelled")
    }
  }

  const stop = () => ctl.current?.abort()

  return (
    <div className={`card panel ${kind === "standard" ? "std" : "eff"}`}>
      <h3>{title}</h3>
      <div className="statline" style={{ margin: "8px 0" }}>
        <button className="run" onClick={start} disabled={state === "running"}>▶ Stream</button>
        <button className="ghost" onClick={stop} disabled={state !== "running"}>■ Cancel</button>
        <span className="pill">{state}</span>
        <span style={{ marginLeft: "auto" }}>{lines.length}/40 events</span>
      </div>
      <div className="bar"><i style={{ width: `${(lines.length / 40) * 100}%` }} /></div>
      <p style={{ margin: "6px 0", fontSize: ".85rem", color: "var(--muted)" }}>
        first event: <b>{first ?? "–"} ms</b> · all events: <b>{total ?? "–"} ms</b>
      </p>
      <div className="stream">
        {lines.length === 0 && <span style={{ color: "#7a8299" }}>{state === "running" ? "waiting for first page…" : "events appear here as they arrive"}</span>}
        {lines.map((l, i) => <div key={i}><span className="t">+{l.t}ms</span>{l.text}</div>)}
      </div>
    </div>
  )
}

export function StreamDemo() {
  return (
    <div className="grid2">
      <StreamPanel kind="standard" title="Standard stream" />
      <StreamPanel kind="effect" title="Effect stream" />
    </div>
  )
}
