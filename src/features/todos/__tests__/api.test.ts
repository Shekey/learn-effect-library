// Tests the WHOLE HTTP pipeline (routing, body validation, status codes, error encoding, client decoding)
// without starting a server or a database. `HttpApiTest.groups` wires the derived typed client straight to the
// handlers. These are the same handlers Next.js serves; only the repository Layer is swapped for memory.
import { Effect, Layer } from "effect"
import { HttpServer } from "effect/http"
import { HttpApiTest } from "effect/http-api"
import { expect, it } from "@effect/vitest"
import { TodosApi } from "../api/TodosApi"
import { TodosApiLive } from "../api/TodosApiLive"
import { TodoId } from "../domain/todo"
import { TodoEvents } from "../domain/todoEvents"
import { TodoRepositoryMemory } from "../infrastructure/todoRepositoryMemory"

const TestLayer = TodosApiLive.pipe(
  Layer.provide([TodoRepositoryMemory, TodoEvents.layer]),
  Layer.merge(HttpServer.layerServices),
)

const makeClient = HttpApiTest.groups(TodosApi, ["todos"])

// PROBLEM: before, a hand-written `run(f)` helper built the client, provided TestLayer and called runPromise.
// EFFECT WAY: `it.layer(TestLayer, { buildPerTest: true })` provides the layer to every test inside and builds it
// FRESH per test (fresh in-memory Map), so tests can't leak state into each other. `it.effect` gives a Scope too.
// DON'T: share one layer across tests here (no buildPerTest): the in-memory todos would leak between tests.
it.layer(TestLayer, { buildPerTest: true })("TodosApi over HTTP (in-memory)", (it) => {
  it.effect("creates, lists and toggles todos", () =>
    Effect.gen(function*() {
      const client = yield* makeClient
      const created = yield* client.todos.create({ payload: { title: "write tests" } })
      expect(created.title).toBe("write tests")

      const toggled = yield* client.todos.toggle({ params: { id: created.id } })
      expect(toggled.completed).toBe(true)

      const all = yield* client.todos.list()
      expect(all.map((t) => t.id)).toContain(created.id)
    }))

  it.effect("turns a 404 into a typed TodoNotFound on the client", () =>
    Effect.gen(function*() {
      const client = yield* makeClient
      // Effect.flip swaps success and error, so we can assert on the error.
      const error = yield* client.todos.getById({ params: { id: TodoId.make(999) } }).pipe(Effect.flip)
      // The error type is TodoNotFound | HttpClientError | SchemaError: narrow by _tag, like catchTags does.
      expect(error._tag).toBe("TodoNotFound")
      if (error._tag === "TodoNotFound") expect(error.id).toBe(999)
    }))

  // The client ENCODES the payload with the same schema before sending. `Schema.Trim` on the Type side means
  // "already trimmed", so these never leave the process. (A raw HTTP body like {"title":"  x  "} IS trimmed by
  // the server while DECODING; try it with curl, see src/app/api/v2/[...path]/route.ts.)
  it.effect.each([["empty", ""], ["untrimmed", "  spaces  "], ["too long", "x".repeat(121)]] as const)(
    "the typed client refuses an invalid payload (%s) before sending it",
    ([, title]) =>
      Effect.gen(function*() {
        const client = yield* makeClient
        const error = yield* client.todos.create({ payload: { title } }).pipe(Effect.flip)
        expect(error._tag).toBe("SchemaError")
        expect((yield* client.todos.list()).some((t) => t.title === title)).toBe(false)
      }),
  )
})
