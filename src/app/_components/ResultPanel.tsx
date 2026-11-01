"use client"

import { Suspense, use } from "react"
import type { Outcome } from "./api"

const tone = (s: number) => (s >= 200 && s < 300 ? "ok" : s >= 400 && s < 500 ? "warn" : "bad")
const label: Record<number, string> = { 200: "OK", 403: "Forbidden", 404: "Not found", 502: "Bad gateway", 504: "Gateway timeout", 0: "Network error" }

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="loading">
      <div className="skel" style={{ height: 30, width: "55%", marginBottom: 12 }} />
      <div className="skel" style={{ height: 8, marginBottom: 12 }} />
      <div className="skel" style={{ height: 120 }} />
    </div>
  )
}

function Body({ promise, expect }: { promise: Promise<Outcome>; expect: number }) {
  // `use` suspends this component until the promise resolves; the <Suspense> fallback shows meanwhile.
  const { status, ms, body } = use(promise)
  return (
    <>
      <div className="statline">
        <span className="status">{status || "ERR"}</span>
        <span className={`pill ${tone(status)}`}>{label[status] ?? "Response"}</span>
        <span className={`pill ${status === expect ? "ok" : "bad"}`}>{status === expect ? "✓ as expected" : `expected ${expect}`}</span>
        <span style={{ marginLeft: "auto", fontWeight: 700 }}>{ms} ms</span>
      </div>
      <div className="bar"><i style={{ width: `${Math.min(100, (ms / 2000) * 100)}%` }} /></div>
      <pre className="json">{JSON.stringify(body, null, 2)}</pre>
    </>
  )
}

export function ResultPanel(props: {
  kind: "std" | "eff"
  title: string
  subtitle: string
  promise: Promise<Outcome> | null
  expect: number
}) {
  return (
    <div className={`card panel ${props.kind}`}>
      <h3>{props.title}</h3>
      <p className="sub">{props.subtitle}</p>
      {props.promise ? (
        <Suspense fallback={<Skeleton />}>
          <Body promise={props.promise} expect={props.expect} />
        </Suspense>
      ) : (
        <div className="empty">Press “Run both” to see the result.</div>
      )}
    </div>
  )
}

function VerdictBody({ both }: { both: Promise<[Outcome, Outcome]> }) {
  const [std, eff] = use(both)
  const same = std.status === eff.status && JSON.stringify(std.body) === JSON.stringify(eff.body)
  const faster = std.ms === eff.ms ? "same speed" : std.ms < eff.ms ? `standard ${eff.ms - std.ms} ms faster` : `effect ${std.ms - eff.ms} ms faster`
  return (
    <div className="verdict">
      <b>{same ? "✓ Identical behavior from the client's point of view." : "⚠ The two responses differ."}</b>{" "}
      <span style={{ color: "var(--muted)" }}>
        ({faster}. Time differences here are mostly random upstream failures and the 5s Effect cache, not language speed. The
        difference is in <i>how much code</i> it took and <i>what the compiler checks</i>.)
      </span>
    </div>
  )
}

export function Verdict({ both }: { both: Promise<[Outcome, Outcome]> | null }) {
  if (!both) return null
  return (
    <Suspense fallback={<div className="verdict"><div className="skel" style={{ height: 18 }} /></div>}>
      <VerdictBody both={both} />
    </Suspense>
  )
}
