import { Context, Effect, flow, Layer, Schedule, Schema } from "effect"
import type { TimeoutError } from "effect/Cause"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { InvalidResponseError, NotFoundError, UpstreamError } from "../domain/errors"
import { UpstreamConfig } from "./upstreamConfig"

// ─────────────────────────────────────────────────────────────────────────────
// PROBLEM: raw `fetch` means every call site re-implements: base URL, status checks, retries, JSON parsing,
//          validation, error mapping, tracing headers. Forget one in one place = production bug.
// EFFECT WAY: build ONE configured client (middleware pipeline) and reuse it. Cross-cutting behavior lives
//             in the client, call sites stay tiny. It's also a *service*: tests can swap it (no network).
// DON'T: call global `fetch` inside Effect code (no tracing, no typed errors, no interruption wiring).
// DON'T: `await` anywhere in Effect code. Effects are values; you unwrap them with `yield*` inside Effect.gen.
// ─────────────────────────────────────────────────────────────────────────────

export type UpstreamFailure = NotFoundError | UpstreamError | InvalidResponseError | TimeoutError

export class UpstreamHttp extends Context.Service<UpstreamHttp, {
  // GET a path and decode the body with a Schema. Every way it can fail is in the return type.
  getJson<S extends Schema.Decoder<unknown>>(path: string, schema: S): Effect.Effect<S["Type"], UpstreamFailure>
}>()("user-profile/UpstreamHttp") {
  // Layer.effect = "build this service using other effects" (here: read config, read the base HttpClient).
  static readonly layer = Layer.effect(
    UpstreamHttp,
    Effect.gen(function*() {
      // WHY yield*: `UpstreamConfig` is an Effect (it can fail if env vars are invalid). `yield*` unwraps its
      // value, or short-circuits the whole layer build with the error. Same idea as `await`, but for Effects.
      const config = yield* UpstreamConfig

      // WHY yield* HttpClient.HttpClient: this *requests* a dependency from the environment. The type of the
      // layer now says "I need an HttpClient", and whoever builds the app must provide one (runtime.ts).
      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequest(flow(HttpClientRequest.prependUrl(config.baseUrl), HttpClientRequest.acceptJson)),
        HttpClient.filterStatusOk, // non-2xx becomes a typed error instead of a silent "ok" response
        // Retries 5xx and transport errors only (NOT 404/400: retrying those is pointless).
        HttpClient.retryTransient({ schedule: Schedule.exponential("100 millis"), times: config.retries }),
      )

      const getJson = <S extends Schema.Decoder<unknown>>(path: string, schema: S) =>
        client.get(path).pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
          // Translate library errors into OUR domain errors at the boundary, so nothing above infrastructure
          // knows which HTTP library we use.
          Effect.mapError((e): NotFoundError | UpstreamError | InvalidResponseError => {
            if (e._tag === "SchemaError") return new InvalidResponseError({ message: e.message })
            const reason = e.reason
            if (reason._tag === "StatusCodeError" && reason.response.status === 404) {
              return new NotFoundError({ resource: path })
            }
            if (reason._tag === "DecodeError") return new InvalidResponseError({ message: e.message })
            return new UpstreamError({ message: e.message })
          }),
          // One overall deadline for the call including its retries. If it wins, the in-flight request is
          // INTERRUPTED (aborted), not leaked. Standard JS can't cancel a Promise; you'd wire AbortController.
          Effect.timeout(config.timeoutMs),
          Effect.withSpan("UpstreamHttp.getJson", { attributes: { path } }),
        )

      return UpstreamHttp.of({ getJson })
    }),
  )
}
