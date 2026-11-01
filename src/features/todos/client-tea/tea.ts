// ─────────────────────────────────────────────────────────────────────────────
// A TINY "ELM ARCHITECTURE" (TEA) RUNTIME, built on Effect. ~120 lines, no dependency.
// Pattern borrowed from https://github.com/savkelita/tea-effect (read it for the full version).
//
// PROBLEM (regular React): state changes are scattered. Every onClick calls setState AND fetch AND maybe
//   another setState in a .then(). To answer "how did the UI get into this state?" you read every handler.
// TEA WAY: there is exactly ONE way to change state:
//     dispatch(msg)  ->  update(msg, model) = [newModel, cmd]  ->  view(newModel)
//   - Msg is plain DATA ("TodoToggled 3"), so it can be logged, replayed and asserted in a test.
//   - update is a PURE function. No fetch inside. It only DESCRIBES side effects by returning a Cmd.
//   - Cmd<Msg> = a Stream of messages (an Effect that will "call back" with messages). The runtime runs it.
//   - Sub<Msg> = a long-lived Stream (a socket, a timer) that is ON while subscriptions(model) lists it.
// EFFECT'S JOB: run Cmds/Subs on fibers, interrupt them when the program stops (Scope), never leak.
// DON'T: call fetch or dispatch from inside update. Return a Cmd instead; that is what keeps update testable.
// ─────────────────────────────────────────────────────────────────────────────
import { Effect, Fiber, FiberSet, Scope, Stream } from "effect"

/** A command: a description of side-effect work that will produce zero or more messages. */
export type Cmd<Msg> = Stream.Stream<Msg>

export const Cmd = {
  none: Stream.empty as Cmd<never>,
  of: <Msg>(msg: Msg): Cmd<Msg> => Stream.make(msg),
  /** Turn an Effect into a Cmd. Both outcomes become messages, so a Cmd can never "throw" past update. */
  attempt: <A, E, Msg>(effect: Effect.Effect<A, E>, onSuccess: (a: A) => Msg, onFailure: (e: E) => Msg): Cmd<Msg> =>
    Stream.fromEffect(effect.pipe(Effect.match({ onSuccess, onFailure }))),
  /** Run several commands concurrently; messages arrive in whatever order the work finishes (like Elm). */
  batch: <Msg>(...cmds: ReadonlyArray<Cmd<Msg>>): Cmd<Msg> => Stream.mergeAll(cmds, { concurrency: "unbounded" }),
}

/** A subscription: a long-running Stream identified by a key. Same key on the next model = keep it running. */
export interface Sub<Msg> {
  readonly key: string
  readonly stream: Stream.Stream<Msg>
}

export interface App<Model, Msg> {
  readonly init: readonly [Model, Cmd<Msg>]
  readonly update: (msg: Msg, model: Model) => readonly [Model, Cmd<Msg>]
  readonly subscriptions?: (model: Model) => ReadonlyArray<Sub<Msg>>
}

export interface Program<Model, Msg> {
  readonly dispatch: (msg: Msg) => void
  readonly getModel: () => Model
  /** Called synchronously after every update. Returns an unsubscribe function. */
  readonly subscribe: (listener: (model: Model) => void) => () => void
  /** Every message processed so far, oldest first. Replay them through `update` to rebuild the model. */
  readonly history: () => ReadonlyArray<Msg>
}

/**
 * Starts a program. All Cmd and Sub fibers live in a FiberSet tied to the surrounding Scope:
 * close the Scope (React unmount) and every in-flight request / open stream is interrupted.
 */
export const program = <Model, Msg>(app: App<Model, Msg>): Effect.Effect<Program<Model, Msg>, never, Scope.Scope> =>
  Effect.gen(function*() {
    const fibers = yield* FiberSet.make<void>()
    const fork = yield* FiberSet.runtime(fibers)<never>()

    let model = app.init[0]
    const listeners = new Set<(model: Model) => void>()
    const history: Array<Msg> = []
    const activeSubs = new Map<string, Fiber.Fiber<void>>()

    // Messages produced by Cmds are fed back through dispatch. That closes the loop.
    const runCmd = (cmd: Cmd<Msg>) => {
      fork(Stream.runForEach(cmd, (msg) => Effect.sync(() => dispatch(msg))))
    }

    // Diff the wanted subscriptions against the running ones: start new keys, interrupt missing keys.
    const syncSubs = () => {
      const wanted = app.subscriptions?.(model) ?? []
      const wantedKeys = new Set(wanted.map((s) => s.key))
      for (const [key, fiber] of activeSubs) {
        if (!wantedKeys.has(key)) {
          activeSubs.delete(key)
          Effect.runFork(Fiber.interrupt(fiber))
        }
      }
      for (const sub of wanted) {
        if (!activeSubs.has(sub.key)) startSub(sub)
      }
    }
    const startSub = (sub: Sub<Msg>) => {
      activeSubs.set(sub.key, fork(Stream.runForEach(sub.stream, (msg) => Effect.sync(() => dispatch(msg)))))
    }

    // Re-entrancy guard: a Cmd that emits synchronously must not run update in the middle of another update.
    let processing = false
    const pending: Array<Msg> = []
    const dispatch = (msg: Msg) => {
      pending.push(msg)
      if (processing) return
      processing = true
      try {
        while (pending.length > 0) {
          const next = pending.shift()!
          history.push(next)
          const [nextModel, cmd] = app.update(next, model)
          model = nextModel
          listeners.forEach((l) => l(model))
          syncSubs()
          runCmd(cmd)
        }
      } finally {
        processing = false
      }
    }

    syncSubs()
    runCmd(app.init[1])

    return {
      dispatch,
      getModel: () => model,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      history: () => history.slice(),
    }
  })

/** Rebuild a model from a list of messages. Pure: Cmds are ignored. This is what "replayable" means. */
export const replay = <Model, Msg>(app: App<Model, Msg>, msgs: ReadonlyArray<Msg>): Model =>
  msgs.reduce((model, msg) => app.update(msg, model)[0], app.init[0])
