// ─────────────────────────────────────────────────────────────────────────────
// Domain errors that also know their HTTP status.
// `httpApiStatus: 404` means: when a handler fails with TodoNotFound, HttpApi answers 404 with this JSON body,
// and the generated CLIENT decodes that 404 back into a real `TodoNotFound` instance. The error survives the
// network round trip with its type intact. Compare with `fetch`: you get `res.status === 404` and a guess.
// ─────────────────────────────────────────────────────────────────────────────
import { Schema } from "effect"
import { TodoId } from "./todo"

export class TodoNotFound extends Schema.TaggedError<TodoNotFound>()(
  "TodoNotFound",
  { id: TodoId },
  { httpApiStatus: 404 },
) {}
