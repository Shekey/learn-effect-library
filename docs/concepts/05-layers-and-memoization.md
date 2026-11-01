# 05 · Layers & memoization

> Run it: `pnpm lesson 26` (`src/lessons/advanced/26-layer-memoization.ts`). The lesson counts how many times a
> constructor runs, so you can watch memoization happen.

## 1. A Layer is a recipe plus a lifetime

A service is the thing you use, like `TodoEvents` with `publish` and `subscribe`. A **Layer** is how that
service gets made:

- **Recipe**: "to build `TodoEvents`, create a bounded PubSub". The recipe can depend on other services.
- **Lifetime**: the layer is built inside a `Scope`. Anything it opens with `Effect.addFinalizer` or
  `acquireRelease` is closed when that scope closes, for example when the runtime is disposed.

Analogy: a Layer works like a kitchen recipe card. The card is not the cake. You can hand the same card to
two cooks. Whether you end up with one cake or two depends on whether they share a kitchen. In Effect the
kitchen is the **MemoMap**.

```
Layer<ROut, E, RIn>
      │     │   └── what the recipe needs (inputs)
      │     └────── how building can fail
      └──────────── what it produces (outputs)
```

### The layer graph in this repo (`src/features/todos/runtime.ts`)

```
        Config(DATABASE_URL)
               │ Layer.unwrap
               ▼
   TodoRepositoryLive ──┐        TodoEvents.layer (PubSub)
   (Postgres | Memory)  │              │
                        └── CoreLive ──┘          Notifier.layerFlaky
                              │                        │
                  provideMerge│                provide │
                              ▼                        ▼
               TodosServicesLive = NotificationWorkers + CleanupJob
                    (exposes TodoRepository | TodoEvents)
                              │ provide
                              ▼
                RoutesLive (HttpApi handlers + Scalar docs)
```

## 2. `merge`, `provide`, `provideMerge`

| Combinator | Picture | Output type |
|---|---|---|
| `Layer.merge(A, B)` / `mergeAll` | `A ‖ B`: side by side, independent | `A \| B` |
| `Layer.provide(Consumer, Dep)` | `Dep → Consumer`, and Dep is **hidden** | `Consumer` |
| `Layer.provideMerge(Consumer, Dep)` | `Dep → Consumer`, and Dep is **still exposed** | `Consumer \| Dep` |

```
merge:          provide:                provideMerge:
 ┌───┐ ┌───┐     ┌─────┐                 ┌─────┐
 │ A │ │ B │     │ Dep │                 │ Dep │──────────┐
 └─┬─┘ └─┬─┘     └──┬──┘                 └──┬──┘          │
   ▼     ▼          ▼                       ▼             ▼
  out: A|B      ┌──────────┐            ┌──────────┐   out: Dep
                │ Consumer │            │ Consumer │
                └────┬─────┘            └────┬─────┘
                     ▼                       ▼
                out: Consumer           out: Consumer
```

In `runtime.ts`, the jobs need the repository and the event bus, **and** the HTTP handlers need them too.
That is why `TodosServicesLive` uses `provideMerge(CoreLive)`: the jobs get their inputs, and the result
still offers `TodoRepository | TodoEvents` to whatever comes next. With plain `provide`, the handlers would
fail to compile because the services would be missing.

Rule of thumb: use `provide` to hide implementation details, and `provideMerge` when the next layer also needs
the dependency.

## 3. Memoization and the MemoMap

**Layers are memoized by reference.** During one build, Effect keeps a `MemoMap` from layer value to the
built service. When a second consumer asks for the same layer value, it gets the instance that already
exists, and the constructor does not run again.

```
one build, one MemoMap                  two builds, two MemoMaps
  Api ──┐                                 runtime A: Api ── Bus #1
        ├── Bus #1  (built once)          runtime B: Sse ── Bus #2   ← different PubSub!
  Sse ──┘
```

### The real bug this prevents

`todos/runtime.ts` builds two things:

1. `ManagedRuntime.make(TodosServicesLive)`, which the SSE route (`app/api/v2/events`) uses to subscribe to
   `TodoEvents`.
2. `HttpRouter.toWebHandler(RoutesLive, …)`, which the API handlers use to **publish** `TodoEvents`.

Both include `TodoEvents.layer`. If each one used its own MemoMap, each would create its **own PubSub**. The
API would publish into PubSub #2 while the browser listened on PubSub #1. Nothing would crash and no error
would appear. Live events would simply never show up.

The fix is a single option:

```ts
const runtime = ManagedRuntime.make(TodosServicesLive)
const web = HttpRouter.toWebHandler(RoutesLive, { memoMap: runtime.memoMap }) // share the kitchen
```

Lesson 26 recreates both versions (sections 3 and 4). It prints `api bus #1, sse bus #2` without the shared
map and `#1, #1` with it.

Also note: **each `Effect.provide(layer)` is its own build.** If you call it in two places, you get two
instances. Compose the graph first and provide it once at the edge (a `ManagedRuntime`).

## 4. Opting out, choosing, owning

- **`Layer.fresh(layer)`**: skip memoization and always build a new instance. Use it when you really want
  isolation, such as a separate connection pool per tenant in a test. Lesson 26, section 2.
- **`Layer.unwrap(effect)`**: run an Effect that *returns a Layer*, then build that layer. This is how
  `TodoRepositoryLive` reads `DATABASE_URL` and picks `TodoRepositorySql` or `TodoRepositoryMemory`.
  Business code never knows which one it received. Lesson 26, section 6.
- **Scoped layers that own resources**: `TodoEvents.layer` adds `PubSub.shutdown` as a finalizer, and the
  SQL layer owns the Postgres pool. When the runtime is disposed, finalizers run in reverse order of
  construction. In lesson 26, each `[Bus] #n released` line is one of these finalizers.

## Where this repo uses it

- `src/features/todos/runtime.ts`: `Layer.unwrap`, `provideMerge`, the shared `memoMap`
- `src/features/todos/domain/todoEvents.ts`: a scoped layer with a finalizer
- `src/features/user-profile/effect/runtime.ts`: a `ManagedRuntime` cached on `globalThis` for hot reload
- `src/lessons/advanced/17-effect-in-nextjs.ts`, `19-sql.ts`, `26-layer-memoization.ts`

## Self-check

1. Two consumers each `Layer.provide(Bus.layer)` inside **one** `mergeAll` that is provided once. How many
   times does `Bus` get built? *(Once: same layer value, same MemoMap.)*
2. You call `Effect.provide(Bus.layer)` in two separate route handlers. Are they sharing state? *(No, there
   are two builds.)*
3. Why does `TodosServicesLive` use `provideMerge` instead of `provide`? *(The HTTP handlers also need
   `TodoRepository | TodoEvents`.)*
4. What breaks, and how would you notice, if `toWebHandler` did not receive `runtime.memoMap`? *(The SSE feed
   stays silent. There is no error.)*
5. When should you reach for `Layer.fresh`? *(When you deliberately want a separate instance.)*
