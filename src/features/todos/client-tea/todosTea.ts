/* eslint-disable @typescript-eslint/no-empty-object-type -- Data.TaggedEnum uses {} for "a case with no fields" */
// ─────────────────────────────────────────────────────────────────────────────
// THE TODOS PAGE AS A TEA PROGRAM: Model + Msg + update + subscriptions. Compare with ../client/todosAtoms.ts.
//
// PROBLEM: the atom version spreads state over many atoms (list, create, toggle, live feed). That is great for
//   server data, but "what is the whole UI state right now, and which event produced it?" has no single answer.
// TEA WAY: one Model value, one Msg union listing EVERYTHING that can happen, one pure update.
//   Read the Msg type below and you know every event this page reacts to. Log the Msgs and you can replay a bug.
// DON'T: put an Effect inside the Model, or run one inside update. Effects only leave update as a Cmd.
// ─────────────────────────────────────────────────────────────────────────────
import { Data, Effect, Queue, Schema, Stream } from "effect"
import { FetchHttpClient } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import { TodosApi } from "../api/TodosApi"
import type { Todo, TodoId } from "../domain/todo"
import { TodoEvent } from "../domain/todoEvents"
import { Cmd, type App, type Sub } from "./tea"

// ── MODEL: the whole page state in one immutable value ──────────────────────
// "Loading | Loaded | Failed" as ONE value, so the view can never show a spinner AND an error.
export type Remote = Data.TaggedEnum<{
  Loading: {}
  Loaded: { readonly value: ReadonlyArray<Todo> }
  Failed: { readonly message: string }
}>
export const Remote = Data.taggedEnum<Remote>()

export interface Model {
  readonly todos: Remote
  readonly draft: string
  readonly saving: boolean
  readonly live: boolean
  readonly events: ReadonlyArray<TodoEvent>
}

// ── MSG: every event, as data. Past tense = "this happened", not "do this". ─
export type Msg = Data.TaggedEnum<{
  TodosLoaded: { readonly todos: ReadonlyArray<Todo> }
  TodosFailed: { readonly message: string }
  DraftChanged: { readonly text: string }
  CreateSubmitted: {}
  TodoSaved: { readonly todo: Todo }
  ToggleClicked: { readonly id: TodoId }
  LiveToggled: {}
  EventReceived: { readonly event: TodoEvent }
}>
export const Msg = Data.taggedEnum<Msg>()

// ── EFFECTS: the only impure part. Each returns a Cmd (a Stream of Msgs). ───
// HttpApiClient.make derives a typed client from the SAME TodosApi contract the atoms use.
const withClient = <A, E>(f: (client: HttpApiClient.ForApi<typeof TodosApi>) => Effect.Effect<A, E>) =>
  HttpApiClient.make(TodosApi, { baseUrl: typeof window === "undefined" ? "http://localhost:3000" : window.location.origin }).pipe(
    Effect.flatMap(f),
    Effect.provide(FetchHttpClient.layer),
  )
const describe = (e: unknown) => (e && typeof e === "object" && "_tag" in e ? String(e._tag) : String(e))

export const fetchTodos: Cmd<Msg> = Cmd.attempt(
  withClient((c) => c.todos.list()),
  (todos): Msg => Msg.TodosLoaded({ todos }),
  (e) => Msg.TodosFailed({ message: describe(e) }),
)
const createTodo = (title: string): Cmd<Msg> =>
  Cmd.attempt(withClient((c) => c.todos.create({ payload: { title } })), (todo): Msg => Msg.TodoSaved({ todo }), (e) => Msg.TodosFailed({ message: describe(e) }))
const toggleTodo = (id: TodoId): Cmd<Msg> =>
  Cmd.attempt(withClient((c) => c.todos.toggle({ params: { id } })), (todo): Msg => Msg.TodoSaved({ todo }), (e) => Msg.TodosFailed({ message: describe(e) }))

// A Sub: the server-sent events feed. The finalizer closes the EventSource when the Sub is switched off.
const decodeEvent = Schema.decodeUnknownSync(Schema.fromJsonString(TodoEvent))
const liveFeed: Sub<Msg> = {
  key: "live-feed",
  stream: Stream.callback<Msg>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const source = new EventSource("/api/v2/events")
        source.onmessage = (m) => Queue.offerUnsafe(queue, Msg.EventReceived({ event: decodeEvent(m.data) }))
        return source
      }),
      (source) => Effect.sync(() => source.close()),
    )),
}

// ── UPDATE: pure. (msg, model) -> [model, cmd]. Unit-testable without a browser or a server. ──
const upsert = (todos: ReadonlyArray<Todo>, todo: Todo) =>
  todos.some((t) => t.id === todo.id) ? todos.map((t) => (t.id === todo.id ? todo : t)) : [...todos, todo]

export const update = (msg: Msg, model: Model): readonly [Model, Cmd<Msg>] =>
  Msg.$match(msg, {
    TodosLoaded: ({ todos }) => [{ ...model, todos: Remote.Loaded({ value: todos }) }, Cmd.none] as const,
    TodosFailed: ({ message }) => [{ ...model, saving: false, todos: Remote.Failed({ message }) }, Cmd.none] as const,
    DraftChanged: ({ text }) => [{ ...model, draft: text }, Cmd.none] as const,
    CreateSubmitted: () =>
      model.draft.trim() === "" || model.saving
        ? ([model, Cmd.none] as const)
        : ([{ ...model, saving: true }, createTodo(model.draft.trim())] as const),
    TodoSaved: ({ todo }) => {
      const todos = Remote.$is("Loaded")(model.todos) ? Remote.Loaded({ value: upsert(model.todos.value, todo) }) : model.todos
      return [{ ...model, todos, saving: false, draft: model.saving ? "" : model.draft }, Cmd.none] as const
    },
    ToggleClicked: ({ id }) => [model, toggleTodo(id)] as const,
    LiveToggled: () => [{ ...model, live: !model.live }, Cmd.none] as const,
    // An event from ANOTHER tab also updates our list: no refetch, just fold it into the model.
    EventReceived: ({ event }) => {
      const events = [event, ...model.events].slice(0, 12)
      const todos = (event._tag === "TodoCreated" || event._tag === "TodoToggled") && Remote.$is("Loaded")(model.todos)
        ? Remote.Loaded({ value: upsert(model.todos.value, event.todo) })
        : model.todos
      return [{ ...model, events, todos }, Cmd.none] as const
    },
  })

// ── SUBSCRIPTIONS: derived from the model. live=false -> the Sub disappears -> its fiber is interrupted. ──
export const subscriptions = (model: Model): ReadonlyArray<Sub<Msg>> => (model.live ? [liveFeed] : [])

export const initialModel: Model = { todos: Remote.Loading(), draft: "", saving: false, live: true, events: [] }

export const todosApp: App<Model, Msg> = { init: [initialModel, fetchTodos], update, subscriptions }
