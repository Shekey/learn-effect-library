// LESSON 16 (advanced): Observability: spans, annotations, logs
//
// PROBLEM: "why was this request slow / which retry failed?" Sprinkling timers and console.logs through
//   business code is noisy and gets lost when you switch tools.
// EFFECT WAY: `Effect.fn("name")` creates a span automatically, nested by the call tree.
//   WHERE spans go is a Layer (console here, OTLP -> Grafana in the app: infrastructure/telemetry.ts).
//
// TRY IT: `pnpm telemetry:up && pnpm dev:otel`, hit /api/effect/profiles?ids=1,2,3, open
//   http://localhost:3001 -> Explore -> Tempo. You'll see getProfiles > getUserProfile > UserResolver.batch > HTTP.
//
// DON'T: put tracing calls inside domain rules. Spans belong at use-case and infrastructure boundaries.
import { Effect, Layer, Tracer } from "effect"

const section = (title: string) => Effect.sync(() => console.log(`\n── ${title} ──`))
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// ── The regular way ──────────────────────────────────────────────────────────
// Timing code mixed into business code. No nesting, no link between the two charges and the checkout.
const regularCharge = async (amount: number) => {
  const start = performance.now()
  await sleep(20)
  console.log(`charged ${amount} in ${(performance.now() - start).toFixed(0)}ms`)
}

const regularWay = async () => {
  const start = performance.now()
  await regularCharge(10)
  await regularCharge(250)
  console.log(`checkout took ${(performance.now() - start).toFixed(0)}ms`)
}

// ── The Effect way ───────────────────────────────────────────────────────────
// Business code: only names and attributes. No timers.
const charge = Effect.fn("charge")(function*(amount: number) {
  yield* Effect.annotateCurrentSpan({ amount }) // searchable in the trace UI ("amount > 100")
  yield* Effect.sleep("20 millis")
  yield* Effect.logInfo("charged", { amount }) // logs are linked to the current span
})

const checkout = Effect.fn("checkout")(function*() {
  yield* charge(10)
  yield* charge(250)
})

// WHERE spans go is just a Layer. This tiny one prints each finished span; the app's version is
// effect/infrastructure/consoleTracer.ts, and telemetry.ts swaps in OTLP without touching `checkout`.
const ConsoleTracerLayer = Layer.succeed(
  Tracer.Tracer,
  Tracer.make({
    span(options) {
      const span = Tracer.nativeTracer.span.call(this, options)
      const end = span.end.bind(span)
      ;(span as { end: typeof span.end }).end = (endTime, exit) => {
        const ms = (Number(endTime - options.startTime) / 1e6).toFixed(0)
        console.log(`[span] ${span.name} ${ms}ms ${exit._tag}`)
        end(endTime, exit)
      }
      return span
    },
  }),
)

export const main = Effect.gen(function*() {
  yield* section("regular way (performance.now + console.log)")
  yield* Effect.promise(regularWay)

  yield* section("Effect way (Effect.fn spans)")
  yield* checkout().pipe(Effect.provide(ConsoleTracerLayer))

  // YOUR TURN: make `charge(250)` fail with Effect.fail("declined"). What does its span print?
})
