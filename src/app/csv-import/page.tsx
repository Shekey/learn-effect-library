"use client"
// /csv-import: pick a CSV (name,email,age), POST it as a stream, and watch the SSE progress events arrive.
// EventSource only does GET, so we read the SSE response body ourselves with fetch + a reader.
import { useRef, useState } from "react"

type Line = { event: string; data: string }

const sample = ["name,email,age", ...Array.from({ length: 250 }, (_, i) =>
  i % 37 === 0 ? `Bad${i},nope,${i}` : `User${i},user${i}@example.com,${20 + (i % 50)}`)].join("\n")

export default function CsvImportPage() {
  const [log, setLog] = useState<Array<Line>>([])
  const [busy, setBusy] = useState(false)
  const abort = useRef<AbortController | null>(null)

  async function upload(body: Blob) {
    setLog([])
    setBusy(true)
    abort.current = new AbortController()
    try {
      const res = await fetch("/api/csv-import", { method: "POST", body, signal: abort.current.signal })
      const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
      let buf = ""
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += value
        const frames = buf.split("\n\n")
        buf = frames.pop() ?? ""
        const parsed = frames.map((f) => ({
          event: /^event: (.*)$/m.exec(f)?.[1] ?? "message",
          data: /^data: (.*)$/m.exec(f)?.[1] ?? "",
        }))
        setLog((l) => [...l, ...parsed])
      }
    } catch (e) {
      setLog((l) => [...l, { event: "Aborted", data: String(e) }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <main style={{ padding: 24, fontFamily: "system-ui", maxWidth: 720 }}>
      <h1>CSV import (lesson 24)</h1>
      <p>Upload → decodeText → splitLines → Schema validate → groupedWithin(100, 1s) → batch insert → SSE.</p>
      <input type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      <button disabled={busy} onClick={() => upload(new Blob([sample], { type: "text/csv" }))}>Import sample (250 rows)</button>
      <button disabled={!busy} onClick={() => abort.current?.abort()}>Cancel</button>
      <ul style={{ fontFamily: "monospace", fontSize: 13 }}>
        {log.map((l, i) => <li key={i}><b>{l.event}</b> {l.data}</li>)}
      </ul>
    </main>
  )
}
