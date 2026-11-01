"use client"
// The VIEW of the TEA program: a plain function of the model. Every user action becomes `dispatch(Msg.X(...))`.
// No useState for data, no fetch, no useEffect for loading: all of that lives in update + Cmds.
import { Msg, Remote, todosApp } from "@/features/todos/client-tea/todosTea"
import { useTea } from "@/features/todos/client-tea/useTea"

export function TeaTodosApp() {
  const { model, dispatch, history } = useTea(todosApp)

  return (
    <div className="grid3">
      <div className="card">
        <b>Todos</b>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            dispatch(Msg.CreateSubmitted())
          }}
        >
          <input value={model.draft} onChange={(e) => dispatch(Msg.DraftChanged({ text: e.target.value }))} placeholder="New todo" />{" "}
          <button disabled={model.saving}>{model.saving ? "Saving…" : "Add"}</button>
        </form>
        {Remote.$match(model.todos, {
          Loading: () => <p className="muted">Loading…</p>,
          Failed: ({ message }) => <p className="muted">Failed: {message}</p>,
          Loaded: ({ value }) => (
            <ul>
              {value.map((t) => (
                <li key={t.id}>
                  <label>
                    <input type="checkbox" checked={t.completed} onChange={() => dispatch(Msg.ToggleClicked({ id: t.id }))} /> {t.title}
                  </label>
                </li>
              ))}
            </ul>
          ),
        })}
      </div>
      <div className="card">
        <b>Live feed (a Sub)</b>
        <p>
          <button onClick={() => dispatch(Msg.LiveToggled())}>{model.live ? "Turn off" : "Turn on"}</button>{" "}
          <small className="muted">off = the Sub leaves subscriptions(model), its fiber is interrupted, the EventSource closes</small>
        </p>
        <ul>{model.events.map((e, i) => <li key={i}><code>{e._tag}</code></li>)}</ul>
      </div>
      <div className="card">
        <b>Message log (replayable)</b>
        <p className="muted"><small>Every state change came from one of these. Feed them to <code>replay()</code> to rebuild the model.</small></p>
        <ol>{history.slice(-15).map((m, i) => <li key={i}><code>{m._tag}</code></li>)}</ol>
      </div>
    </div>
  )
}
