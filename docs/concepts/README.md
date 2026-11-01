# Concepts: read these before the lessons

Each concept doc explains ONE idea in plain language (analogies, diagrams, "where this repo uses it", a short quiz).
Read the doc, then run the lesson it prepares you for, then look at the app feature that uses it.

**Rule for this repo: concept doc -> lesson -> app feature, in that order.** A new feature starts with the concept
doc (why), then a runnable lesson (regular way vs Effect way), and only then the code in `src/features/` / `src/app/`.

| # | Concept doc | Prepares for | Used in the app |
|---|---|---|---|
| 01 | [Streaming](./01-streaming.md): pull vs push, lazy, chunks, hot vs cold | lesson 15 `streams`, lesson 22 `streaming-101` | `/api/v2/events` (SSE), profile streams |
| 02 | [Backpressure](./02-backpressure.md): a producer faster than its consumer, buffer strategies | lesson 20 `queue-pubsub-schedule`, lesson 23 `backpressure` | todos jobs Queue + PubSub |
| 03 | [Concurrency](./03-concurrency.md): fibers, structured concurrency, interruption, bounded parallelism | lessons 11 `concurrency`, 12 `semaphores-and-fibers`, 13 `resources-scope` | batch profiles, todos workers |
| 04 | [Errors and Cause](./04-errors-and-cause.md): failures vs defects vs interruption, what a `Cause` holds | lesson 07 `typed-errors`, lesson 25 `errors-and-cause` | route `catchTags`, `runHttp` |
| 05 | [Layers and memoization](./05-layers-and-memoization.md): a Layer is built once, `MemoMap`, `Layer.fresh` | lesson 08 `services-and-layers`, lesson 26 `layer-memoization` | `runtime.ts` composition roots |
| 06 | [Atoms vs TEA](./06-atoms-vs-tea.md): Effect Atom compared with The Elm Architecture (model / update / view) | LEARNING.md step 6 | `/todos` (atoms) vs `/todos-tea` |

## Lessons that go with these docs

| # | Lesson | Concept doc | Run |
|---|---|---|---|
| 22 | `advanced/22-streaming-101` | [01](./01-streaming.md) | `pnpm lesson 22` |
| 23 | `advanced/23-backpressure` | [02](./02-backpressure.md) | `pnpm lesson 23` |
| 24 | `advanced/24-stream-toolbox`: real stream operators on a CSV import (app: `/csv-import`) | [01](./01-streaming.md), [02](./02-backpressure.md) | `pnpm lesson 24` |
| 25 | `advanced/25-errors-and-cause` | [04](./04-errors-and-cause.md) | `pnpm lesson 25` |
| 26 | `advanced/26-layer-memoization` | [05](./05-layers-and-memoization.md) | `pnpm lesson 26` |
