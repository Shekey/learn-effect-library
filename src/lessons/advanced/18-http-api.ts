// LESSON 18 (advanced): HttpApi. Define the API ONCE, get the server, a typed client and the docs.
//
// PROBLEM: a regular fetch-based API has four hand-written parts that nobody keeps in sync:
//   the route handler, the fetch wrapper, the response TYPE (`as Todo`), and the OpenAPI docs.
//   Errors arrive as `res.status === 404` and a body you have to guess the shape of.
// EFFECT WAY: one contract (src/features/todos/api/TodosApi.ts) built from Schemas.
//   - server:  HttpApiBuilder.group(...)   -> must implement every endpoint, with decoded inputs
//   - client:  HttpApiClient / HttpApiTest -> `client.todos.getById({ params: { id } })`, fully typed,
//              and a 404 comes back as an instance of TodoNotFound (the SAME class the server failed with)
//   - docs:    OpenApi.fromApi(TodosApi)   -> the JSON behind http://localhost:3000/api/v2/docs
// DON'T: write `fetch` + `as SomeType` for an API you own. Derive the client from the contract.
//
// This lesson runs everything in memory (no server, no DB). The real thing: `pnpm dev`, open /todos.
import { Effect, Layer } from "effect"
import { HttpServer } from "effect/http"
import { HttpApiTest, OpenApi } from "effect/http-api"
import { TodosApi } from "../../features/todos/api/TodosApi"
import { TodosApiLive } from "../../features/todos/api/TodosApiLive"
import { TodoId } from "../../features/todos/domain/todo"
import { TodoEvents } from "../../features/todos/domain/todoEvents"
import { TodoRepositoryMemory } from "../../features/todos/infrastructure/todoRepositoryMemory"

const section = (title: string) => Effect.sync(() => console.log(`\n── ${title} ──`))

// ── The regular way ──────────────────────────────────────────────────────────
// A pretend server (what `export async function GET` would be) and a hand-written client for it.
type TodoDto = { id: number; title: string; completed: boolean }
const fakeServer = async (url: string): Promise<Response> => {
  const id = Number(url.split("/").pop())
  return id === 1
    ? Response.json({ id: 1, title: "hello", completed: false })
    : Response.json({ message: "not found" }, { status: 404 })
}
const regularGetTodo = async (id: number): Promise<TodoDto> => {
  const res = await fakeServer(`/api/todos/${id}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`) // the caller gets a string, not a type
  return (await res.json()) as TodoDto //               "trust me" cast: nothing checks this
}
const regularWay = async () => {
  console.log("found:", await regularGetTodo(1))
  try {
    await regularGetTodo(999)
  } catch (e) {
    console.log("missing:", String(e), "<- an Error with a message. Is it a 404? a timeout? Parse the string.")
  }
}

// ── The Effect way ───────────────────────────────────────────────────────────
// The handlers Next.js serves, with the in-memory repository instead of Postgres.
const ServerLayer = TodosApiLive.pipe(
  Layer.provide([TodoRepositoryMemory, TodoEvents.layer]),
  Layer.merge(HttpServer.layerServices),
)

const effectWay = Effect.gen(function*() {
  // A typed client wired straight to the handlers: real routing, encoding and decoding, no network.
  const client = yield* HttpApiTest.groups(TodosApi, ["todos"])

  const created = yield* client.todos.create({ payload: { title: "learn HttpApi" } })
  console.log("created:", created) // a real `Todo` instance, decoded and validated

  const found = yield* client.todos.getById({ params: { id: created.id } })
  console.log("found:", found.title)

  // The 404 is a VALUE in the error channel, with its own fields. `catchTag` is checked by the compiler:
  // rename the error in domain/errors.ts and this line stops compiling.
  const missing = yield* client.todos.getById({ params: { id: TodoId.make(999) } }).pipe(
    Effect.map(() => "?"),
    Effect.catchTag("TodoNotFound", (e) => Effect.succeed(`TodoNotFound for id ${e.id} (a typed 404)`)),
    Effect.catchTags({ HttpClientError: () => Effect.succeed("network"), SchemaError: () => Effect.succeed("bad data") }),
  )
  console.log("missing:", missing)

  // Invalid input never leaves the client: it encodes with the same schema the server decodes with.
  const invalid = yield* client.todos.create({ payload: { title: "" } }).pipe(Effect.flip)
  console.log("empty title:", invalid._tag, "(refused before sending)")

  // The docs are derived from the same contract.
  const spec = OpenApi.fromApi(TodosApi)
  console.log("OpenAPI paths:", Object.keys(spec.paths).join(", "))
}).pipe(Effect.scoped, Effect.provide(ServerLayer))

export const main = Effect.gen(function*() {
  yield* section("regular way (fetch + `as Todo` + status codes)")
  yield* Effect.promise(regularWay)

  yield* section("Effect way (one HttpApi contract -> server, client, docs)")
  yield* effectWay

  // YOUR TURN:
  //  1. In TodosApi.ts add `error: TodoNotFound` to `create`. Nothing else changes, but now the client's
  //     `create` error type includes TodoNotFound. Hover `client.todos.create` to see it.
  //  2. Delete the `toggle` handler in TodosApiLive.ts: the compiler lists the missing endpoint.
  //  3. `pnpm dev`, open http://localhost:3000/api/v2/docs and send requests from the docs page.
})
