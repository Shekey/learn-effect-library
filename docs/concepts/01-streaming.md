# 01. Streaming 101

> You don't need Effect to understand this page. Learn the idea first, then the API.
> Runnable companion: `pnpm lesson 22` ([`src/lessons/advanced/22-streaming-101.ts`](../../src/lessons/advanced/22-streaming-101.ts)).
> After that, [lesson 15](../../src/lessons/advanced/15-streams.ts) uses these ideas for real work.

## 1. What a stream is: a pipe, not a bucket

An **array** is a bucket. It is full before you can use it: every value exists in memory at the same time.

A **stream** is a pipe. Values come out one after another, over time. You handle each one as it arrives,
and the pipe may never "finish" at all.

```
Array (bucket)                          Stream (pipe)

  [ 1, 2, 3, 4, 5 ]   <- all exist now     source ==> 1 ==> 2 ==> 3 ==> ...  ==> you
  wait until full, then use it             use each value the moment it arrives
```

In plain JS the simplest pipe is a **generator** (`function*` / `async function*`): it produces the next
value only when someone asks. In Effect it is `Stream<A, E, R>`: values of type `A`, may fail with `E`,
needs services `R`. Like an `Effect`, a `Stream` is only a *description*: nothing happens until you run it
with a `Stream.run*` function (`runCollect`, `runForEach`, `runDrain`, ...).

Lesson 22, section 1 shows an endless generator and an endless `Stream.iterate` where only 3 values are made.

## 2. Why stream at all?

| Reason | Bucket problem | Pipe answer |
|---|---|---|
| **Memory** | 1M database rows = 1M objects in RAM at once | only a few rows in memory at any moment |
| **Time to first byte** | the user waits until the *last* row is ready | the user sees the first row right away |
| **Endless data** | events, logs, a live feed never "finish", so the bucket is never full | a pipe doesn't need an end |

**Where this repo uses it:** [`streamEvents.ts`](../../src/features/user-profile/effect/application/streamEvents.ts)
walks a paginated API without loading every page first, and
[`/api/effect/events-stream`](../../src/app/api/effect/events-stream/route.ts) sends each event to the browser
as soon as it exists.

## 3. Pull vs push: who decides when the next value comes?

```
PULL  (consumer is the boss)                PUSH  (producer is the boss)

  consumer --"next please"--> producer        producer --value--> consumer
  consumer <------ value ---- producer        producer --value--> consumer   (ready or not!)
```

- **Pull**: the consumer asks for the next value. `for await (const x of asyncIterator)`, Effect `Stream`.
  A slow consumer just asks less often, so the producer automatically slows down. This is called
  *backpressure* (its own topic: [02-backpressure](./02-backpressure.md)).
- **Push**: the producer sends whenever it wants. `EventEmitter`, DOM events (`click`), `WebSocket.onmessage`,
  the browser's `EventSource`. If the consumer is slow, values must be **buffered** (kept in a queue) or **dropped**.

Effect `Stream` is pull-based, but it can wrap a push source: `Stream.callback` gives you a queue; the
push source drops values into it, and the stream pulls them out. Bonus: when the stream stops, its cleanup
removes the listener for you.

**Where this repo uses it:** [`todosAtoms.ts`](../../src/features/todos/client/todosAtoms.ts) wraps the
browser's push-based `EventSource` in `Stream.callback`. Lesson 22, section 2 does the same with an `EventEmitter`.

## 4. Cold vs hot: does it start over for each listener?

```
COLD (a recipe / a video on demand)          HOT (a live radio broadcast)

  consumer A --> starts from the start         broadcast: e1 ... e2 ... e3 ... e4 ...
  consumer B --> starts from the start again                       ^
  (work is done once PER consumer)                    late listener joins here, hears e3, e4
```

- **Cold**: nothing runs until someone consumes it, and each consumer gets its own fresh run.
  `Stream.paginate(...)` hitting an API is cold: two consumers = two sets of API calls.
- **Hot**: it is already running whether or not anyone listens. Join late and you missed the earlier values.
  A `PubSub`, a Server-Sent Events feed, a stock ticker.

**Where this repo uses it:**
- cold: `Stream.paginate` in [`streamEvents.ts`](../../src/features/user-profile/effect/application/streamEvents.ts)
  (each request to `/api/effect/events-stream` walks the pages again).
- hot: the `TodoEvents` PubSub in [`todoEvents.ts`](../../src/features/todos/domain/todoEvents.ts), served by
  [`/api/v2/events`](../../src/app/api/v2/events/route.ts). A browser tab opened later only sees new events.

## 5. Chunks: values travel in small batches

Passing values one at a time means one hand-off (an `await`, a function call) **per value**. For a million
numbers that overhead adds up. So streams move values in **chunks**: small arrays, one hand-off per chunk.

```
one by one:   [1] -> [2] -> [3] -> [4] -> [5] -> [6]      6 hand-offs
in chunks:    [1, 2, 3] -> [4, 5, 6]                       2 hand-offs
```

You still write `Stream.map((n) => n * 2)` per value; Effect handles the chunks underneath.
`Stream.chunks` lets you see them, `Stream.rechunk(n)` changes their size. Network bytes do the same thing:
a `fetch()` body is a `ReadableStream` of `Uint8Array` pieces, and you don't control how big each piece is.
That is why a line of text can be split across two chunks, and why decoders (`Stream.decodeText`,
`Stream.splitLines`) exist. Lesson 22, section 4.

## 6. On the wire: how a stream travels over HTTP

All of these send data bit by bit over one long-lived connection, instead of one finished response.

| Format | Direction | What it looks like | Use it when |
|---|---|---|---|
| **Plain chunked HTTP** | server -> client | any bytes, sent as they are ready (`Transfer-Encoding: chunked`) | big downloads, files, raw text |
| **NDJSON** (`application/x-ndjson`) | server -> client | one JSON object per line: `{"id":1}\n{"id":2}\n` | a finite list of records you want to process one by one (exports, search results) |
| **Server-Sent Events** (`text/event-stream`) | server -> client only | `data: {...}\n\n` blocks; the browser's `EventSource` parses them and **reconnects automatically** | live notifications / feeds in the browser |
| **WebSocket** | both ways | a separate protocol (`ws://`) with messages in both directions | chat, games, collaborative editing: the client also sends a lot |

Rule of thumb: need only server -> browser updates? SSE. A finite batch of records? NDJSON.
Both directions, many messages? WebSocket.

**Where this repo uses it:**
- NDJSON: [`/api/effect/events-stream`](../../src/app/api/effect/events-stream/route.ts) (Effect) and
  [`/api/standard/events-stream`](../../src/app/api/standard/events-stream/route.ts) (regular). Each line is
  built with `JSON.stringify(event) + "\n"` in `streamEvents.ts`.
- SSE: [`/api/v2/events`](../../src/app/api/v2/events/route.ts), read by `EventSource` in
  [`todosAtoms.ts`](../../src/features/todos/client/todosAtoms.ts). Note the `": keep-alive"` comment every 15s
  so proxies don't close an idle connection.
- WebSocket: not used. Nothing here needs the client to push a stream of messages back.

## 7. Lifecycle: every stream ends in exactly one of three ways

```
start --> value, value, value --+--> END     (the source ran out: success)
                                +--> ERROR   (something failed: a typed E in Effect)
                                +--> CANCEL  (the consumer left: the tab was closed, take(3) had enough)
```

Cleanup (closing a DB cursor, removing a listener, aborting an upstream `fetch`) must happen in **all three**.

- Regular JS: `try { ... } finally { cleanup }` inside a generator. A `break` in `for await` calls the
  generator's `return()`, so `finally` runs on cancel too. For `ReadableStream` you implement `cancel()`.
- Effect: `Stream.ensuring(cleanup)` runs on end, error and cancel. `Stream.onExit` tells you which one.
  A cancel is an *interruption*: the fiber running the stream is stopped, and every finalizer runs.

**Where this repo uses it:** both Effect routes use `Stream.toReadableStreamEffect`. When the browser
disconnects, the `ReadableStream` is cancelled, Effect interrupts the stream, and the PubSub subscription
(or the in-flight page request) is cleaned up. No manual `AbortController`, no leaked listeners.
Lesson 22, section 5 shows end / error / cancel side by side.

## Check yourself

1. You need the first 10 lines of a 5 GB log file. Bucket or pipe? Why?
2. A `for await` loop processes each item slowly. Does an async generator keep producing values in the meantime?
   What about an `EventEmitter`?
3. Two React components each run the same `Stream.paginate(...)` over an API. How many times is the API called? Is that stream hot or cold?
4. You open the todos page 5 minutes after the server started. Do you see the `TodoEvent`s from minute 1? Why not?
5. Why do streams pass values in chunks instead of one at a time?
6. You're building a notification bell (server -> browser only). SSE, NDJSON or WebSocket? And for a multiplayer drawing board?
7. Name the three ways a stream can end. Which one happens when the user closes the tab?
8. Why is `Stream.runCollect` on an endless stream a bug?

<details>
<summary>Answers</summary>

1. Pipe: read 10 lines and stop (`take(10)`). A bucket would load all 5 GB first.
2. No: a generator is pull-based and pauses at `yield` until asked. The `EventEmitter` keeps pushing; values pile up or get lost.
3. Twice. It is cold: each consumer runs the recipe from the start.
4. No. The PubSub is hot: you only receive events published after you subscribed.
5. One hand-off per chunk instead of per value: much less overhead.
6. SSE (one direction, auto-reconnect). WebSocket for the drawing board (both directions, many messages).
7. End, error, cancel (interruption). Closing the tab is a cancel.
8. It tries to fill a bucket that never gets full: it never returns and memory grows forever. Bound it with `Stream.take` or use `Stream.runForEach`.

</details>
