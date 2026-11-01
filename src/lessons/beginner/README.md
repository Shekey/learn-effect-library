# Beginner (about 45 minutes)

Goal: leave knowing what an Effect is, what `yield*` does, how errors and dependencies show up in the type, and how to retry.
Run any lesson with `pnpm lesson NN`. Every file ends with a **YOUR TURN** exercise.

Every lesson prints two sections: **regular way** (plain async/await) first, then **Effect way**. Present them
in that order. Show the pain, then the fix. The "regular" code is in the same file, above the Effect code.

| # | What the regular way shows |
|---|---|
| 01 | A Promise runs on creation, and awaiting twice doesn't run it twice |
| 02 | `try/catch` gives you `unknown`; the error isn't in the type |
| 03 | A timeout needs `Promise.race` plus a timer, and the slow work keeps running |
| 04 | `throw` is invisible, so you need `instanceof` checks |
| 05 | Passing dependencies by hand through every function |
| 06 | A hand-written `for` loop with try/catch for retries |

| # | Lesson | Talking points | Live demo |
|---|---|---|---|
| 01 | effect-is-a-description | A Promise runs now, an Effect runs when you say. `Effect<Success, Error, Requirements>` | `pnpm lesson 01`, point at `runs = 0` |
| 02 | gen-and-yield | `Effect.gen` is async/await; `yield*` = "run it, give me the value". Missing `*` is the classic bug | `pnpm lesson 02` |
| 03 | fn-vs-gen-vs-pipe | gen = steps, fn = reusable function with a span, pipe = decorate | `pnpm lesson 03` |
| 04 | typed-errors-basics | `throw` is invisible, Effect errors are in the type. `catchTag`, `result`, `orElseSucceed` | hover `findUser` in the editor |
| 05 | first-service | declare / use / provide. Forget `provide` and TypeScript refuses | delete the `provide`, show the compile error |
| 06 | retry-basics | `retry`, `tapError` vs `tap`, why the counter lives inside `Effect.gen` | `pnpm lesson 06`, then change `times` |

Suggested slide order: 01 -> 02 -> 04 -> 05 -> 06 -> 03 (fn/pipe last, it is style rather than concept).

Avoid on beginner slides: Layers building on Layers, Schema transforms, fibers, Scope. They come later.

Next: [`docs/concepts/`](../../../docs/concepts/README.md) explains the bigger ideas (streams, concurrency, errors, layers) before the intermediate and advanced lessons.
