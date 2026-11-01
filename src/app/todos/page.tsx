import Link from "next/link"
import { TodosAppClientOnly } from "./TodosAppClientOnly"

export default function TodosPage() {
  return (
    <main className="page">
      <header className="hero">
        <p><Link href="/">← back to the profile demo</Link></p>
        <h1>Full-stack Effect: one contract, typed all the way</h1>
        <p>
          One <code>HttpApi</code> definition (<code>src/features/todos/api/TodosApi.ts</code>) gives the server handlers, this
          page’s typed client, and the <a href="/api/v2/docs" target="_blank">API docs</a>. Storage is Postgres when{" "}
          <code>DATABASE_URL</code> is set (<code>pnpm db:up</code>), otherwise in-memory. Same code, different Layer.
        </p>
      </header>
      <section className="section">
        <TodosAppClientOnly />
      </section>
      <section className="section">
        <div className="grid3 tips">
          <div className="card"><b>Try</b><ul><li>Look up id <code>999</code>: a typed <code>TodoNotFound</code></li><li>Add 5 todos fast: watch the 2 workers and retries</li><li>Open a 2nd tab: both feeds update</li></ul></div>
          <div className="card"><b>Read</b><ul><li><code>features/todos/api/TodosApi.ts</code></li><li><code>features/todos/client/todosAtoms.ts</code></li><li><code>features/todos/jobs/todoJobs.ts</code></li></ul></div>
          <div className="card"><b>Run</b><ul><li><code>pnpm lesson 18</code> … <code>21</code></li><li><code>pnpm test</code></li><li><code>pnpm db:up</code> then restart <code>pnpm dev</code></li></ul></div>
        </div>
      </section>
    </main>
  )
}
