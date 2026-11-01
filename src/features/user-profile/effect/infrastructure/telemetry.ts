import { Config, Effect, Layer, Option } from "effect"
import { FetchHttpClient } from "effect/http"
import { OtlpLogger, OtlpSerialization, OtlpTracer } from "effect/observability"
import { ConsoleTracerLayer } from "./consoleTracer"

// ─────────────────────────────────────────────────────────────────────────────
// PROBLEM: you want to *see* what the app did (which call was slow, which retried), but you don't want
//          tracing code scattered through business logic or a vendor SDK wired into every file.
// EFFECT WAY: spans are created by `Effect.fn` / `Effect.withSpan` (already in the code). WHERE they go is
//             decided here, by one Layer. Swap the Layer = new backend. Business code is untouched.
//
// Run `pnpm telemetry:up` then `pnpm dev:otel` and open Grafana (http://localhost:3001) -> Explore -> Tempo.
// Without the env var we fall back to the console tracer (no Docker needed).
//
// Layer.unwrap = "decide which Layer to use by running an Effect first" (here: read config).
// ─────────────────────────────────────────────────────────────────────────────
export const TelemetryLayer = Layer.unwrap(
  Effect.gen(function*() {
    const endpoint = yield* Config.String("OTEL_EXPORTER_OTLP_ENDPOINT").pipe(Config.option)
    if (Option.isNone(endpoint)) return ConsoleTracerLayer

    const resource = { serviceName: "learn-effect-library", serviceVersion: "0.1.0" }
    return Layer.merge(
      OtlpTracer.layer({ url: `${endpoint.value}/v1/traces`, resource }),
      OtlpLogger.layer({ url: `${endpoint.value}/v1/logs`, resource }),
    ).pipe(
      // The exporters themselves need a serializer and an HTTP client: also just Layers.
      Layer.provide(OtlpSerialization.layerJson),
      Layer.provide(FetchHttpClient.layer),
    )
  }),
)
