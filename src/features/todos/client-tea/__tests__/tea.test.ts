// TEA's selling point: update is pure, so the page logic is tested with plain values. No server, no DOM, no mocks.
import { Effect, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { Todo, TodoId } from "../../domain/todo"
import { Cmd, program, replay, type App } from "../tea"
import { initialModel, Msg, Remote, update } from "../todosTea"

const todo = (id: number, completed = false) => new Todo({ id: TodoId.make(id), title: `t${id}`, completed })

describe("todos update (pure)", () => {
  it("loads, then folds a live TodoToggled event into the list", () => {
    const [loaded] = update(Msg.TodosLoaded({ todos: [todo(1)] }), initialModel)
    const [next] = update(Msg.EventReceived({ event: { _tag: "TodoToggled", todo: todo(1, true) } }), loaded)
    expect(next.todos).toEqual(Remote.Loaded({ value: [todo(1, true)] }))
    expect(next.events).toHaveLength(1)
  })

  it("ignores an empty draft and returns no work", () => {
    const [model, cmd] = update(Msg.CreateSubmitted(), initialModel)
    expect(model).toBe(initialModel)
    expect(cmd).toBe(Cmd.none)
  })

  it("is replayable: the same messages always give the same model", () => {
    const app: App<typeof initialModel, Msg> = { init: [initialModel, Cmd.none], update }
    const msgs = [Msg.TodosLoaded({ todos: [] }), Msg.DraftChanged({ text: "x" }), Msg.LiveToggled()]
    expect(replay(app, msgs)).toEqual(replay(app, msgs))
    expect(replay(app, msgs).live).toBe(false)
  })
})

describe("tea runtime", () => {
  type CounterMsg = "Inc" | "IncLater"
  const counter: App<number, CounterMsg> = {
    init: [0, Cmd.of<CounterMsg>("Inc")],
    update: (msg, n) => (msg === "Inc" ? [n + 1, Cmd.none] : [n, Cmd.attempt(Effect.sleep("5 millis"), (): CounterMsg => "Inc", (): CounterMsg => "Inc")]),
  }

  it("runs Cmds and feeds their messages back into update", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(Effect.gen(function*() {
        const p = yield* program(counter)
        p.dispatch("IncLater")
        yield* Effect.sleep("20 millis")
        return [p.getModel(), p.history()] as const
      })),
    )
    expect(result[0]).toBe(2)
    expect(result[1]).toEqual(["Inc", "IncLater", "Inc"])
  })

  it("starts and stops subscriptions as the model changes", async () => {
    let finalized = 0
    const ticks = Stream.never.pipe(Stream.ensuring(Effect.sync(() => void finalized++)))
    const app: App<boolean, "Toggle"> = {
      init: [true, Cmd.none],
      update: (_msg, on) => [!on, Cmd.none],
      subscriptions: (on) => (on ? [{ key: "ticks", stream: ticks }] : []),
    }
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const p = yield* program(app)
      yield* Effect.sleep("5 millis")
      p.dispatch("Toggle")
      yield* Effect.sleep("5 millis")
    })))
    expect(finalized).toBe(1)
  })
})
