# Intermediate (about 1 hour)

Goal: write real use cases: several error types, swappable services, validated input, resilient calls, bounded parallelism.
Prerequisite: the beginner lessons.

Every lesson prints two sections: **regular way** (plain async/await) first, then **Effect way**. Present them
in that order. Show the pain, then the fix. The "regular" code is in the same file, above the Effect code.

| # | What the regular way shows |
|---|---|
| 07 | An `instanceof` chain: add an error class and nothing complains |
| 08 | `new Cached(new Repo(new Http()))` wiring, repeated in every entry point |
| 09 | A type, a guard and a mapper that drift apart; the guard can't say *why* the data is invalid |
| 10 | A retry loop with manual backoff; `Promise.race` leaves the slow task running |
| 11 | Chunked `Promise.all`; race and all leave the losers running |

| # | Lesson | Talking points | Live demo |
|---|---|---|---|
| 07 | typed-errors | `catchTags` is exhaustive: add an error and every caller stops compiling. Failure vs defect (`orDie`) | add a third error class, show `tsc` errors |
| 08 | services-and-layers | The service is the port, the Layer is the adapter. `provide` vs `provideMerge`. Layer wrapping another (decorator) | remove `Layer.provide(HttpLive)`, show the compile error naming `Http` |
| 09 | schema | One definition gives type + validator + decoder. Bad input becomes a typed failure with a readable path | print the `why:` message |
| 10 | resilience | Backoff schedule, `while:` retries only transient errors, timeout *interrupts* the slow work | `pnpm lesson 10` |
| 11 | concurrency | `concurrency: N` bounds parallelism; `race` cancels the loser; a failing `all` cancels siblings | watch the "interrupted" lines |

Suggested slide order: 07 -> 08 -> 09 -> 10 -> 11.

Presenter tip: lesson 09 ends with `decodeTo` (wire format to domain). Mark it optional if time is short.
See it in the real code: `src/features/user-profile/effect/` (errors, repository port, adapters).
