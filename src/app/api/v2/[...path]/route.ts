// The WHOLE todos API in one file. Next.js gives us a Web `Request`; Effect's HttpRouter answers with a Web
// `Response`. Routing, body parsing, validation, status codes, OpenAPI and the docs page all come from
// src/features/todos/api/TodosApi.ts. Compare with src/app/api/effect/profile/[id]/route.ts, where each route
// is a separate file with hand-written status codes.
//
// Try:  curl localhost:3000/api/v2/todos
//       curl -XPOST localhost:3000/api/v2/todos -H 'content-type: application/json' -d '{"title":""}'   -> 400
//       curl localhost:3000/api/v2/todos/999                                                            -> 404
//       open http://localhost:3000/api/v2/docs
import { todosApp } from "@/features/todos/runtime"

const handle = (req: Request) => todosApp.web.handler(req)

export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE }
