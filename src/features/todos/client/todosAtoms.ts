// ─────────────────────────────────────────────────────────────────────────────
// FRONTEND STATE, the Effect way: atoms (`effect/reactivity` + `@effect/atom-react`).
//
// PROBLEM (regular React): useEffect + useState + fetch per component:
//   - loading/error/data are three loose useStates that can disagree (loading=false, data=undefined, error=undefined?)
//   - errors are `unknown`; you can't tell "todo not found" from "server down" without string matching
//   - the request is NOT cancelled when the component unmounts (race conditions, setState on unmounted)
//   - after a mutation you must remember every component that shows the list and refetch each one
// EFFECT WAY:
//   - an atom holds an AsyncResult<A, E>: Initial | Success | Failure, ONE value, never inconsistent
//   - E is typed from the API contract: TodoNotFound is a real class here, in the browser
//   - when nothing reads an atom any more, its Effect is INTERRUPTED (the fetch is aborted)
//   - mutations carry `reactivityKeys`; every query tagged with the same key refreshes itself
// DON'T: put atoms inside components (they are module-level definitions, like routes), or call fetch by hand.
// ─────────────────────────────────────────────────────────────────────────────
import { Effect, Option, Queue, Schema, Stream } from "effect"
import { FetchHttpClient } from "effect/http"
import { Atom, AtomHttpApi } from "effect/reactivity"
import { withDemoToken } from "../api/auth"
import { TodosApi } from "../api/TodosApi"
import { TodoId } from "../domain/todo"
import { TodoEvent } from "../domain/todoEvents"

// The typed client, derived from the SAME TodosApi the server implements. No hand-written fetch wrappers.
// `client.todos.create` only accepts `{ payload: { title } }`; a typo is a compile error in the browser code.
export class TodosClient extends AtomHttpApi.Service<TodosClient>()("TodosClient", {
  api: TodosApi,
  httpClient: FetchHttpClient.layer,
  baseUrl: typeof window === "undefined" ? "http://localhost:3000" : window.location.origin,
  // Every request carries `Authorization: Bearer demo-token`, so protected endpoints (todos.me) succeed.
  transformClient: withDemoToken,
}) {}

// A QUERY atom. Anything reading it gets AsyncResult<ReadonlyArray<Todo>, ...>.
// reactivityKeys: ["todos"] = "refresh me whenever a mutation touches 'todos'".
export const todosAtom = TodosClient.query("todos", "list", { reactivityKeys: ["todos"] })

// MUTATION atoms: call them with a request, they run the Effect and expose the result.
export const createTodoAtom = TodosClient.mutation("todos", "create")
export const toggleTodoAtom = TodosClient.mutation("todos", "toggle")

// A FAMILY: one atom per id, created on demand and cached. Its error type includes TodoNotFound.
export const todoByIdAtom = Atom.family((id: number) =>
  TodosClient.query("todos", "getById", { params: { id: TodoId.make(id) }, reactivityKeys: ["todos"] }),
)

// LIVE FEED: an atom built from a Stream. The browser's EventSource is wrapped in Stream.callback; the
// finalizer closes it when no component reads the atom any more (navigate away -> connection closed).
//
// PROBLEM (regular way): decoding with Schema.decodeUnknownSync inside `source.onmessage`. A malformed or
// newer event THROWS inside a browser callback, outside any fiber: untyped, not logged by Effect, and the
// Stream never hears about it.
// EFFECT WAY: never throw inside callbacks you hand to Stream.callback. Move the RAW string into Effect
// first (the queue), then validate inside the Stream with Schema.decodeUnknownEffect.
// CHOICE: a bad frame is LOGGED and SKIPPED (Effect.option), so one weird event doesn't kill the whole
// feed. A connection error (`onerror`) ENDS the stream, so the atom can be re-read/retried.
// DON'T: call decodeUnknownSync (or anything else that can throw) inside onmessage.
const decodeEvent = Schema.decodeUnknownEffect(Schema.fromJsonString(TodoEvent))
const rawServerEvents = Stream.callback<string>((queue) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const source = new EventSource("/api/v2/events")
      source.onmessage = (msg) => Queue.offerUnsafe(queue, String(msg.data))
      source.onerror = () => {
        source.close()
        Queue.endUnsafe(queue)
      }
      return source
    }),
    (source) => Effect.sync(() => source.close()),
  ),
)
const serverEvents = rawServerEvents.pipe(
  Stream.mapEffect((raw) =>
    decodeEvent(raw).pipe(
      Effect.tapError((error) => Effect.logWarning("Skipping malformed SSE frame", raw, error)),
      Effect.option,
    ),
  ),
  Stream.filter(Option.isSome),
  Stream.map((some) => some.value),
)
// Stream.scan keeps the latest 12 events, newest first. The atom's value updates on every element.
export const liveEventsAtom = Atom.make(
  serverEvents.pipe(Stream.scan((): ReadonlyArray<TodoEvent> => [], (acc, e: TodoEvent) => [e, ...acc].slice(0, 12))),
)
