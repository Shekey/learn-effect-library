// ─────────────────────────────────────────────────────────────────────────────
// PROBLEM: "when a todo is created, also: write an audit log, send a notification, update the live feed".
//   Regular way: the create handler calls all three in a row. It gets slower with each new consumer, one
//   failing consumer fails the request, and the handler has to know about every consumer.
// EFFECT WAY: the handler PUBLISHES one event to a PubSub. Each consumer SUBSCRIBES on its own fiber.
//   Adding a consumer = adding a subscriber; the handler never changes.
// ─────────────────────────────────────────────────────────────────────────────
import { Context, Effect, Layer, PubSub, Schema, Stream } from "effect"
import { Todo } from "./todo"

// Events are Schemas too, so the live feed can send them as JSON and the browser can decode them.
export const TodoEvent = Schema.Union([
  Schema.TaggedStruct("TodoCreated", { todo: Todo }),
  Schema.TaggedStruct("TodoToggled", { todo: Todo }),
  Schema.TaggedStruct("NotificationSent", { todoId: Schema.Number, attempt: Schema.Number }),
  Schema.TaggedStruct("CleanupRan", { removed: Schema.Number }),
])
export type TodoEvent = typeof TodoEvent.Type

export class TodoEvents extends Context.Service<TodoEvents, {
  publish(event: TodoEvent): Effect.Effect<void>
  /** Every subscriber gets EVERY event published after it subscribed (fan-out, unlike a Queue). */
  readonly subscribe: Stream.Stream<TodoEvent>
}>()("todos/TodoEvents") {
  static readonly layer = Layer.effect(
    TodoEvents,
    Effect.gen(function*() {
      // bounded(256): if a subscriber is 256 events behind, publishers wait (backpressure) instead of
      // the process slowly running out of memory. `replay: 20` lets a new browser tab see recent history.
      const pubsub = yield* PubSub.bounded<TodoEvent>({ capacity: 256, replay: 20 })
      // Layer.effect runs inside a Scope: when the runtime shuts down, the PubSub shuts down and every
      // subscriber stream ends cleanly. No dangling listeners.
      yield* Effect.addFinalizer(() => PubSub.shutdown(pubsub))
      return TodoEvents.of({
        publish: (event) => PubSub.publish(pubsub, event).pipe(Effect.asVoid),
        subscribe: Stream.fromPubSub(pubsub),
      })
    }),
  )
}
