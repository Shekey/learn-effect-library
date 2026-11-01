import { Layer, Tracer } from "effect"

// Tiny tracer: native spans, plus one console line per finished span. Swap for OTLP in production without touching use cases.
const consoleTracer = Tracer.make({
  span(options) {
    const span = Tracer.nativeTracer.span.call(this, options)
    const end = span.end.bind(span)
    ;(span as { end: typeof span.end }).end = (endTime, exit) => {
      console.log(`[span] ${span.name} ${(Number(endTime - options.startTime) / 1e6).toFixed(0)}ms ${exit._tag}`)
      end(endTime, exit)
    }
    return span
  },
})

export const ConsoleTracerLayer = Layer.succeed(Tracer.Tracer, consoleTracer)
