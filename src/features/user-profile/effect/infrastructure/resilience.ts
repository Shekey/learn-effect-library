import { Effect, Schedule } from "effect"

// PROBLEM: retry loops get re-invented per call site, usually without backoff or "don't retry 404".
// EFFECT WAY: a policy is a function Effect -> Effect. Compose it once, apply anywhere, test it with TestClock.
// NOTE: the app's HttpClient has its own `retryTransient`; this helper is the generic version for NON-HTTP
//   effects and is what the tests exercise (lesson 10 shows the same idea).
//
// Timeout + retry policy as one reusable combinator. Only transient upstream failures are retried.
export const withResilience = (options: { readonly timeoutMs: number; readonly retries: number }) =>
  <A, E extends { readonly _tag: string }, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.timeout(options.timeoutMs),
      Effect.retry({
        schedule: Schedule.exponential("100 millis"),
        times: options.retries,
        while: (e) => e._tag === "UpstreamError",
      }),
    )

// ─────────────────────────────────────────────────────────────────────────────
// HEDGED REQUEST
// PROBLEM: 1 in 20 calls is slow (tail latency). Waiting for it ruins your p99.
// EFFECT WAY: start the call; if it hasn't answered after `afterMs`, start a SECOND identical call and take
//   whichever succeeds first. `Effect.race` interrupts the loser automatically (its HTTP request is aborted).
// DON'T: do this for non-idempotent calls (payments!) or when the upstream is already overloaded: you double the load.
// STANDARD TS: Promise.race can't cancel the loser; you must wire AbortControllers for both by hand.
// ─────────────────────────────────────────────────────────────────────────────
export const hedged = (afterMs: number) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.race(effect, Effect.delay(effect, afterMs))
