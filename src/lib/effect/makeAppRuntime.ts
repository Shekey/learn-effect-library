// ─────────────────────────────────────────────────────────────────────────────
// makeAppRuntime: ONE shared way to own a ManagedRuntime inside Next.js.
//
// PROBLEM (regular way):
//   const runtime = ManagedRuntime.make(AppLayer)            // module scope
//   Next dev re-evaluates the module on every edit -> a NEW runtime each time, and the old one is never
//   disposed: its worker fibers, schedules and DB pool keep running until you restart `pnpm dev`.
//   The usual fix, `globalThis.__rt ??= ManagedRuntime.make(AppLayer)`, stops the duplicates but freezes
//   the wiring: edits to the Layer are silently ignored until a restart.
//
// EFFECT WAY:
//   Cache the runtime on globalThis under a key, remember WHICH layer built it, and when the module reloads
//   with a different layer value, `dispose()` the old runtime (finalizers run, fibers are interrupted, pools
//   close) before building the new one. On SIGTERM (prod shutdown, `docker stop`, ...) every cached runtime
//   is disposed so finalizers get a chance to run.
//
// TRADE-OFF (documented once, here):
//   - A reload of the composition-root module ALWAYS rebuilds (a re-evaluated module produces a new Layer
//     object, so identity changes). In-memory state held by the runtime (caches, the in-memory todo store)
//     is reset on that edit. Edits to modules that don't re-evaluate the root keep the runtime.
//   - Disposal is fire-and-forget: a request arriving during the swap uses the new runtime while the old
//     one finishes shutting down in the background.
//
// DON'T: create runtimes per request, or call ManagedRuntime.make at module scope without this helper.
// ─────────────────────────────────────────────────────────────────────────────
import { Layer, ManagedRuntime } from "effect"

interface Disposable {
  readonly dispose: () => Promise<void>
}

type Entry = { readonly version: unknown; readonly value: Disposable }
type Registry = { entries: Map<string, Entry>; sigtermHooked: boolean }

const g = globalThis as unknown as { __effectAppRuntimes?: Registry }
const registry = (g.__effectAppRuntimes ??= { entries: new Map(), sigtermHooked: false })

const disposeQuietly = (key: string, value: Disposable) =>
  value.dispose().catch((error) => console.error(`[makeAppRuntime] failed to dispose "${key}"`, error))

const hookSigterm = () => {
  // The Edge runtime has no `process.once`; guard so the helper is safe to import anywhere.
  if (registry.sigtermHooked || typeof process === "undefined" || typeof process.once !== "function") return
  registry.sigtermHooked = true
  process.once("SIGTERM", () => {
    const all = [...registry.entries].map(([key, { value }]) => disposeQuietly(key, value))
    registry.entries.clear()
    void Promise.all(all).finally(() => process.exit(0))
  })
}

/**
 * Low-level building block: cache any disposable value on globalThis under `key`.
 * If the cached value was built from a different `version`, dispose it and build a fresh one.
 */
export const makeAppSingleton = <A extends Disposable>(key: string, version: unknown, build: () => A): A => {
  hookSigterm()
  const existing = registry.entries.get(key)
  if (existing && existing.version === version) return existing.value as A
  if (existing) {
    console.info(`[makeAppRuntime] "${key}" wiring changed, disposing the previous runtime`)
    void disposeQuietly(key, existing.value)
  }
  const value = build()
  registry.entries.set(key, { version, value })
  return value
}

/** Cache a ManagedRuntime for `layer` under `key`; the previous runtime is disposed when the layer changes. */
export const makeAppRuntime = <R, E>(
  key: string,
  layer: Layer.Layer<R, E, never>,
): ManagedRuntime.ManagedRuntime<R, E> => makeAppSingleton(key, layer, () => ManagedRuntime.make(layer))
