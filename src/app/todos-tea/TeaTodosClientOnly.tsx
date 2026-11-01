"use client"
// Like /todos: the program runs Effects (HTTP, EventSource), so it renders in the browser only.
import dynamic from "next/dynamic"

export const TeaTodosClientOnly = dynamic(() => import("./TeaTodosApp").then((m) => m.TeaTodosApp), {
  ssr: false,
  loading: () => <p className="muted">Starting the program…</p>,
})
