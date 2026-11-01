"use client"
// Atoms run Effects (HTTP calls, an EventSource, the clock). Running them during the server prerender is
// pointless here (there is no user yet) and Next.js rejects reading the clock while prerendering.
// So the interactive part renders in the browser only. For SSR'd atom data, see `Hydration` in effect/reactivity.
import dynamic from "next/dynamic"

export const TodosAppClientOnly = dynamic(() => import("./TodosApp").then((m) => m.TodosApp), {
  ssr: false,
  loading: () => <p className="muted">Loading the app…</p>,
})
