import { BatchDemo } from "./_components/BatchDemo"
import { Playground } from "./_components/Playground"
import { StreamDemo } from "./_components/StreamDemo"

export default function Home() {
  return (
    <main className="page">
      <header className="hero">
        <h1>Effect vs standard TypeScript</h1>
        <p>
          One feature, built twice with the same clean-code layers. Same inputs, same API, same results. What changes is how
          much the compiler knows and how much code it takes. Everything below is live: it calls real routes in this app.
        </p>
      </header>

      <section className="section">
        <h2>What is being tested</h2>
        <p className="lead">A “user profile” endpoint that talks to a deliberately unreliable fake service.</p>
        <div className="card">
          <div className="flow">
            <span className="node">Browser</span><span className="arrow">→</span>
            <span className="node">API route<br /><small>/api/<span style={{ color: "var(--std)" }}>standard</span> or <span style={{ color: "var(--eff)" }}>effect</span></small></span><span className="arrow">→</span>
            <span className="node">Application<br /><small>use case</small></span><span className="arrow">→</span>
            <span className="node">Domain<br /><small>business rules</small></span><span className="arrow">→</span>
            <span className="node">Infrastructure<br /><small>HTTP client, retry, cache</small></span><span className="arrow">→</span>
            <span className="node">Fake upstream<br /><small>40% random 500s, 404s, hangs</small></span>
          </div>
          <div className="legend">
            <span><span className="pill std">Standard</span> async/await, throw, hand-written retry</span>
            <span><span className="pill eff">Effect</span> typed errors, dependency injection, built-in retry/timeout/tracing</span>
          </div>
        </div>
      </section>

      <section className="section">
        <h2>1. One request, four situations</h2>
        <p className="lead">Pick a situation, read what it tests, press run. Both implementations answer the same request.</p>
        <Playground />
      </section>

      <section className="section">
        <h2>2. Many requests: the N+1 problem</h2>
        <p className="lead">
          Loading several profiles. The standard version asks the upstream once per id (twice per profile: user + posts). The Effect
          version collects concurrent lookups and asks once for all of them, de-duplicating repeated ids, without changing the
          use case code. Fewer calls means less load and less latency on a real service.
        </p>
        <BatchDemo />
      </section>

      <section className="section">
        <h2>3. Streaming a large list</h2>
        <p className="lead">
          40 events in pages of 5, each page takes ~150 ms. Both stream results as they arrive (watch “first event”). Press
          Cancel mid-way: the Effect version interrupts its in-flight request automatically, the standard version needs
          hand-written abort wiring.
        </p>
        <StreamDemo />
      </section>

      <section className="section">
        <h2>4. Full stack: API contract, Postgres, background jobs, React atoms</h2>
        <p className="lead">
          A small todo app built with one <code>HttpApi</code> contract: typed server, typed browser client, generated docs, Postgres
          (or in-memory) storage, queue workers, a scheduled job and a live feed. <a href="/todos">Open /todos →</a>{" "}
          <a href="/api/v2/docs" target="_blank">API docs</a>
        </p>
      </section>

      <section className="section">
        <h2>Where to look next</h2>
        <div className="grid3 tips">
          <div className="card"><b>See inside the request</b>
            <ul><li>Run <code>pnpm telemetry:up</code> and <code>pnpm dev:otel</code></li><li>Open <a href="http://localhost:3001" target="_blank">Grafana</a> → Explore → Tempo</li><li>Only Effect routes are traced</li></ul></div>
          <div className="card"><b>Read the code</b>
            <ul><li><code>src/features/user-profile/standard</code></li><li><code>src/features/user-profile/effect</code></li><li><code>LEARNING.md</code> for a guided path</li></ul></div>
          <div className="card"><b>Learn by running</b>
            <ul><li><code>pnpm lesson</code> lists 21 lessons (beginner, intermediate, advanced)</li><li><code>pnpm test:watch</code> for instant tests</li><li><code>EXPLANATION.md</code>: pros and cons</li></ul></div>
        </div>
      </section>
    </main>
  )
}
