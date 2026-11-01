// A port for "send a notification" (email, Slack, push...). The live version is slow and flaky ON PURPOSE,
// so you can watch the queue apply backpressure and the retry policy kick in. Tests swap in a deterministic one.
import { Context, Effect, Layer, Random, Schema } from "effect"
import type { Todo } from "../domain/todo"

export class NotifyFailed extends Schema.TaggedError<NotifyFailed>()("NotifyFailed", { todoId: Schema.Number }) {}

export class Notifier extends Context.Service<Notifier, {
  send(todo: Todo): Effect.Effect<void, NotifyFailed>
}>()("todos/Notifier") {
  // 400 ms per call, 40% failure rate. Uses Effect's Random and Clock (via sleep), so even this is testable.
  static readonly layerFlaky = Layer.succeed(Notifier, Notifier.of({
    send: (todo) =>
      Effect.gen(function*() {
        yield* Effect.sleep("400 millis")
        if ((yield* Random.next) < 0.4) return yield* new NotifyFailed({ todoId: todo.id })
        yield* Effect.logInfo(`📧 notified about todo #${todo.id} "${todo.title}"`)
      }),
  }))
}
