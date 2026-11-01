import { Effect, Layer } from "effect"
import { makeAppRuntime } from "@/lib/effect/makeAppRuntime"
import { FetchHttpClient } from "effect/http"
import type { UserRepository } from "./domain/userRepository"
import { TelemetryLayer } from "./infrastructure/telemetry"
import { UpstreamHttp } from "./infrastructure/upstreamHttp"
import { UserRepositoryCached } from "./infrastructure/userRepositoryCached"
import { UserRepositoryBatched } from "./infrastructure/userRepositoryBatched"

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSITION ROOT: the ONE place that wires implementations to ports.
// Read it bottom-up: FetchHttpClient -> UpstreamHttp -> UserRepositoryBatched -> UserRepositoryCached
// (userRepositoryHttp.ts is the unbatched adapter: swap it in here to feel the N+1 difference.).
//
// Layer.provide(x)       = feed x into the layer, hide x from the result   (x is an internal detail)
// Layer.provideMerge(x)  = feed x into the layer, ALSO keep x in the result (x stays available to others)
// ─────────────────────────────────────────────────────────────────────────────
export const AppLayer = UserRepositoryCached.pipe(
  Layer.provide(UserRepositoryBatched),
  Layer.provideMerge(UpstreamHttp.layer), // keep UpstreamHttp visible: the streaming route uses it directly
  Layer.provide(FetchHttpClient.layer),
  Layer.provideMerge(TelemetryLayer),
)

// Next.js dev reloads modules on every edit. makeAppRuntime caches the runtime on globalThis and disposes the
// previous one when this wiring changes (and on SIGTERM). See src/lib/effect/makeAppRuntime.ts for the trade-off.
type AppServices = UserRepository | UpstreamHttp
const runtime = makeAppRuntime("user-profile", AppLayer)

// WHERE Effect meets the outside world: the ONLY place we call `runPromise`.
// DON'T call runPromise deep inside business code: you lose typed errors, DI, and interruption.
// The parameter type `Effect<Response, never, ...>` means the caller MUST have handled every error
// (catchTags) before getting here; forgetting one is a compile error.
// `signal`: if the client disconnects, Next aborts it and Effect INTERRUPTS the whole running program.
export const runHttp = (effect: Effect.Effect<Response, never, AppServices>, signal?: AbortSignal) =>
  runtime.runPromise(effect, { signal })
