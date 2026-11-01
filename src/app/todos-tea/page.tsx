import Link from "next/link"
import { TeaTodosClientOnly } from "./TeaTodosClientOnly"

export default function TeaTodosPage() {
  return (
    <main className="page">
      <header className="hero">
        <p><Link href="/">← home</Link> · <Link href="/todos">atom version</Link></p>
        <h1>The same todos, as The Elm Architecture</h1>
        <p>
          One <code>Model</code>, one <code>Msg</code> union, one pure <code>update</code>. Effect runs the side effects
          (<code>Cmd</code> = a Stream of messages, <code>Sub</code> = a long-lived Stream). Same API, same live feed as{" "}
          <Link href="/todos">/todos</Link>. Read <code>docs/concepts/06-atoms-vs-tea.md</code> for when to pick which.
        </p>
      </header>
      <section className="section">
        <TeaTodosClientOnly />
      </section>
      <section className="section">
        <div className="grid3 tips">
          <div className="card"><b>Read</b><ul><li><code>features/todos/client-tea/tea.ts</code> (the runtime)</li><li><code>features/todos/client-tea/todosTea.ts</code></li><li><code>features/todos/client/todosAtoms.ts</code></li></ul></div>
          <div className="card"><b>Try</b><ul><li>Add a todo, watch the message log</li><li>Turn the live feed off and on</li><li>Toggle in /todos in another tab</li></ul></div>
          <div className="card"><b>Test</b><ul><li><code>pnpm test</code>: update is tested with zero mocks</li></ul></div>
        </div>
      </section>
    </main>
  )
}
