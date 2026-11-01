"use client"
// Read src/features/todos/client/todosAtoms.ts first: this component only READS atoms and CALLS mutations.
// Notice: no useEffect, no fetch, no isLoading/error useStates, no manual refetch after a mutation.
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { Cause, Exit, Schema } from "effect"
import { AsyncResult } from "effect/reactivity"
import { useState } from "react"
import { createTodoAtom, liveEventsAtom, todoByIdAtom, todosAtom, toggleTodoAtom } from "@/features/todos/client/todosAtoms"
import { CreateTodo } from "@/features/todos/domain/todo"
import type { TodoEvent } from "@/features/todos/domain/todoEvents"

// The SAME schema the server validates with, now validating in the browser. Change maxLength in
// domain/todo.ts and the input, the server, the OpenAPI docs and this check all change together.
const validateCreate = Schema.decodeUnknownExit(CreateTodo)

function TodoList() {
  const todos = useAtomValue(todosAtom)
  const toggle = useAtomSet(toggleTodoAtom)

  // AsyncResult.builder: handle each state once. TypeScript knows which cases are left.
  return AsyncResult.builder(todos)
    .onInitial(() => <p className="muted">Loading…</p>)
    .onSuccess((list, result) => (
      <ul className="todo-list" style={{ opacity: result.waiting ? 0.6 : 1 }}>
        {list.length === 0 && <li className="muted">Nothing here. Add one above.</li>}
        {list.map((todo) => (
          <li key={todo.id}>
            <label>
              <input
                type="checkbox"
                checked={todo.completed}
                // reactivityKeys: ["todos"] -> after the PATCH succeeds, todosAtom refreshes itself.
                onChange={() => toggle({ params: { id: todo.id }, reactivityKeys: ["todos"] })}
              />
              <span className={todo.completed ? "done" : ""}>#{todo.id} {todo.title}</span>
            </label>
          </li>
        ))}
      </ul>
    ))
    // `list` declares no errors in TodosApi.ts, so there is NO onError here: the compiler removed that case.
    // Network failures / invalid responses are defects (unexpected), handled once:
    .onDefect((defect) => <p className="pill bad">Could not load todos: {String(defect)}</p>)
    .render()
}

function CreateForm() {
  const [title, setTitle] = useState("")
  const [message, setMessage] = useState<string | null>(null)
  // mode "promiseExit": calling it returns Promise<Exit>, so we can show success/failure inline.
  const create = useAtomSet(createTodoAtom, { mode: "promiseExit" })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const local = validateCreate({ title })
    if (Exit.isFailure(local)) return setMessage(`Rejected in the browser (shared schema): ${Cause.squash(local.cause)}`)

    const exit = await create({ payload: local.value, reactivityKeys: ["todos"] })
    if (Exit.isSuccess(exit)) {
      setTitle("")
      setMessage(`Created #${exit.value.id}. The list refreshed itself (reactivityKeys).`)
    } else setMessage(`Server said no: ${Cause.pretty(exit.cause)}`)
  }

  return (
    <form onSubmit={submit} className="todo-form">
      <input className="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing? (1–120 chars)" />
      <button className="run" type="submit">Add</button>
      <button className="ghost" type="button" title="Skips the form check and calls the typed client directly"
        onClick={() => create({ payload: { title: "" }, reactivityKeys: ["todos"] }).then((exit) =>
          setMessage(Exit.isFailure(exit)
            ? `The typed client refused to even send it (it encodes with the same schema): ${Cause.squash(exit.cause)}`
            : "?"))}>
        Skip the form check
      </button>
      {message && <p className="muted small">{message}</p>}
    </form>
  )
}

function Lookup() {
  const [id, setId] = useState(1)
  const result = useAtomValue(todoByIdAtom(id))
  return (
    <div>
      <label className="small">Todo id <input className="text" type="number" value={id} onChange={(e) => setId(Number(e.target.value) || 0)} style={{ width: 90 }} /></label>
      <div style={{ marginTop: 8 }}>
        {AsyncResult.builder(result)
          .onInitial(() => <span className="muted">Loading…</span>)
          .onSuccess((todo) => <span className="pill ok">#{todo.id} {todo.title}{todo.completed ? " ✓" : ""}</span>)
          // TodoNotFound is a TYPED error that crossed the network: the server's 404 body was decoded back into
          // the class. `error.id` is typed. Try id 999.
          .onErrorTag("TodoNotFound", (error) => <span className="pill warn">TodoNotFound (id {error.id}): a typed 404</span>)
          // After handling TodoNotFound there are NO typed errors left, so `.onError` would not even compile.
          // Network down / invalid response are defects (unexpected):
          .onDefect((d) => <span className="pill bad">Unexpected: {String(d)}</span>)
          .render()}
      </div>
    </div>
  )
}

const describe = (e: TodoEvent) => {
  switch (e._tag) {
    case "TodoCreated": return `➕ created #${e.todo.id} "${e.todo.title}"`
    case "TodoToggled": return `☑️ toggled #${e.todo.id} -> ${e.todo.completed ? "done" : "open"}`
    case "NotificationSent": return `📧 worker notified about #${e.todoId} (attempt ${e.attempt})`
    case "CleanupRan": return `🧹 scheduled cleanup removed ${e.removed} completed todo(s)`
  }
}

function LiveFeed() {
  const events = useAtomValue(liveEventsAtom)
  return AsyncResult.builder(events)
    .onInitial(() => <p className="muted small">Connecting… add a todo to see events.</p>)
    .onSuccess((list) => (
      <ul className="feed">
        {list.map((e, i) => <li key={list.length - i}>{describe(e)}</li>)}
      </ul>
    ))
    .onError(() => <p className="pill bad">Feed disconnected</p>)
    .onDefect((d) => <p className="pill bad">Bug: {String(d)}</p>)
    .render()
}

export function TodosApp() {
  return (
    <div className="grid2">
      <div className="card">
        <h3>Todos <span className="pill eff">query + mutation atoms</span></h3>
        <CreateForm />
        <TodoList />
      </div>
      <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
        <div className="card">
          <h3>Typed errors across the network</h3>
          <Lookup />
        </div>
        <div className="card">
          <h3>Live feed <span className="pill eff">PubSub → SSE → Stream atom</span></h3>
          <p className="muted small">Every todo you add is put on a bounded Queue; 2 worker fibers “send a notification” (slow, 40% flaky, retried with backoff). Completed todos are removed by a scheduled job.</p>
          <LiveFeed />
        </div>
      </div>
    </div>
  )
}
