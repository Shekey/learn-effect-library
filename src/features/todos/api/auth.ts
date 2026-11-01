// ─────────────────────────────────────────────────────────────────────────────
// AUTH MIDDLEWARE for the HttpApi contract (browser-safe: descriptions only, no server logic).
//
// CONCEPT: a middleware is code that runs AROUND a handler. It can reject the request (401) or ADD something
// to the context before the handler runs. Here it reads `Authorization: Bearer <token>` and provides
// `CurrentUser`.
//
// PROBLEM (regular Next.js): every route calls `const user = await getUser(req); if (!user) return 401`.
//   Forget it in one route and that route is public. Nothing checks it.
// EFFECT WAY: a handler that does `yield* CurrentUser` has `CurrentUser` in its requirements (the R type).
//   Only endpoints marked `.middleware(Authorization)` get it provided, so using CurrentUser in an endpoint
//   WITHOUT the middleware is a compile error. The type system remembers to check auth for you.
// DON'T: put the token check in the contract. The server implementation (AuthorizationLive) lives in
//   TodosApiLive.ts so it is never shipped to the browser.
// ─────────────────────────────────────────────────────────────────────────────
import { Context, Effect, Redacted, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { HttpApiMiddleware, HttpApiSecurity } from "effect/http-api"

export class User extends Schema.Class<User>("User")({
  id: Schema.String,
  name: Schema.String,
}) {}

// The service the middleware PROVIDES. Handlers read it with `yield* CurrentUser`.
export class CurrentUser extends Context.Service<CurrentUser, User>()("todos/CurrentUser") {}

// A typed 401. Like TodoNotFound, the client decodes the body back into a real `Unauthorized` instance.
export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  "Unauthorized",
  { message: Schema.String },
  { httpApiStatus: 401 },
) {}

export class Authorization extends HttpApiMiddleware.Service<Authorization, {
  provides: CurrentUser
  requires: never
}>()("todos/Authorization", {
  // false: clients may call the API without a client-side middleware Layer. The browser adds the header
  // itself (see `withDemoToken`), and endpoints without `.middleware(Authorization)` stay public.
  requiredForClient: false,
  // Decodes `Authorization: Bearer ...` for us and documents the scheme in OpenAPI (/api/v2/docs).
  security: { bearer: HttpApiSecurity.bearer },
  error: Unauthorized,
}) {}

// FAKE auth for learning. A real app would verify a JWT/session here.
export const DEMO_TOKEN = "demo-token"
export const demoUser = new User({ id: "u-1", name: "Demo User" })

// Pure check, used by the server layer (TodosApiLive.ts).
export const verifyToken = (token: Redacted.Redacted<string>) =>
  Redacted.value(token) === DEMO_TOKEN
    ? Effect.succeed(demoUser)
    : Effect.fail(new Unauthorized({ message: "Missing or invalid bearer token" }))

// Client side: attach the demo bearer token to every request (used by TodosClient).
export const withDemoToken = (client: HttpClient.HttpClient) =>
  HttpClient.mapRequest(client, HttpClientRequest.bearerToken(DEMO_TOKEN))
