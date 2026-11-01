"use client"
// ─────────────────────────────────────────────────────────────────────────────
// React binding for the TEA runtime. React only RENDERS the model and forwards events as messages.
// PROBLEM: a program owns fibers (HTTP calls, an EventSource). They must stop when the component unmounts.
// EFFECT WAY: the program runs inside a Scope; unmount closes the Scope, which interrupts every fiber.
// DON'T: create the program during render (React may render twice). Start it in an effect.
// ─────────────────────────────────────────────────────────────────────────────
import { Effect, Exit, Scope } from "effect"
import { useCallback, useEffect, useRef, useState } from "react"
import { program, type App, type Program } from "./tea"

export const useTea = <Model, Msg>(app: App<Model, Msg>) => {
  const [model, setModel] = useState(app.init[0])
  const programRef = useRef<Program<Model, Msg> | null>(null)
  const [history, setHistory] = useState<ReadonlyArray<Msg>>([])

  useEffect(() => {
    const scope = Scope.makeUnsafe()
    const p = Effect.runSync(program(app).pipe(Scope.provide(scope)))
    programRef.current = p
    const sync = () => {
      setModel(p.getModel())
      setHistory(p.history())
    }
    const unsubscribe = p.subscribe(sync)
    sync()
    return () => {
      unsubscribe()
      programRef.current = null
      Effect.runFork(Scope.close(scope, Exit.void))
    }
  }, [app])

  const dispatch = useCallback((msg: Msg) => programRef.current?.dispatch(msg), [])
  return { model, dispatch, history } as const
}
