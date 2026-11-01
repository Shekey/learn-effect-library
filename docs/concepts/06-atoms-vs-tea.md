# 06. Frontend state: Effect Atoms vs The Elm Architecture (TEA)

This repo has the same todos page built two ways:

- `/todos` uses **atoms** (`src/features/todos/client/todosAtoms.ts`)
- `/todos-tea` uses **TEA** (`src/features/todos/client-tea/`), with a small runtime written on Effect
  (`tea.ts`, about 120 lines), modeled on [savkelita/tea-effect](https://github.com/savkelita/tea-effect)

Both use the same `TodosApi` contract and the same live feed. What differs is **where state lives and how it changes**.

## The analogy

- **Atoms are a spreadsheet.** Each cell (atom) holds a value or a formula over other cells. Change one cell and only
  the cells that depend on it recompute. Nobody holds "the whole sheet state" in one place, and nobody needs to.
- **TEA is a bank ledger.** There is one balance (the Model). The only way to change it is to add a line to the
  ledger (a Msg). The balance is whatever you get by applying every line in order. Want to know why the balance is
  wrong? Read the ledger.

## What TEA is

Four pieces:

| Piece | What it is | In this repo |
|---|---|---|
| `Model` | the whole UI state, one immutable value | `Model` in `todosTea.ts` |
| `Msg` | a union of everything that can happen, as **data** | `Msg` (TodosLoaded, ToggleClicked, ...) |
| `update` | pure `(msg, model) => [model, cmd]` | `update` |
| `view` | pure `model => UI`, user actions become `dispatch(msg)` | `TeaTodosApp.tsx` |

Plus two ways to talk to the outside world:

| Piece | Meaning | Effect equivalent |
|---|---|---|
| `Cmd<Msg>` | "do this work, then tell me what happened" | an `Effect` / short `Stream` that ends in messages |
| `Sub<Msg>` | "keep listening while the model says so" | a long-lived `Stream`, interrupted when no longer wanted |

### Unidirectional data flow

```
          ┌──────────────────────────────────────────────┐
          │                                              │
  user ──►│ dispatch(Msg) ──► update(msg, model)         │
  click   │                     │            │           │
          │                new Model       Cmd           │
          │                     │            │           │
          │                   view      runtime runs it  │
          │                     │       on a fiber (Effect)
          │                     ▼            │           │
          │                  screen          └─► Msg ────┘ (back to dispatch)
          └──────────────────────────────────────────────┘
```

Data only goes one way around the loop. There is no "the fetch callback sets three states" side channel.

### Why messages are data

Because `Msg.ToggleClicked({ id: 3 })` is a plain value, you can:

- **log** it (the `/todos-tea` page shows the message log live)
- **replay** it: `replay(app, msgs)` in `tea.ts` rebuilds the model from a list of messages
- **test** it: `update(msg, model)` is a pure function call, no server, no DOM, no mocks
  (see `src/features/todos/client-tea/__tests__/tea.test.ts`)

A callback (`onClick={() => fetch(...).then(setX)}`) can do none of these. You can't log or compare a closure.

### Where Effect fits

`update` never runs anything. It returns a `Cmd`, which in our runtime is just `Stream.Stream<Msg>`. The runtime:

1. forks every Cmd into a `FiberSet` (concurrent, like Elm)
2. turns each emitted message into another `dispatch`
3. diffs `subscriptions(model)` by key after every update: new keys start a fiber, missing keys get interrupted
4. runs in a `Scope`: React unmount closes the Scope, every in-flight request and open `EventSource` stops

That last point is the same guarantee atoms give you (no reader -> Effect interrupted), reached a different way.

## Atoms vs TEA

| | Atoms (`/todos`) | TEA (`/todos-tea`) |
|---|---|---|
| State shape | many small cells | one Model |
| How state changes | set an atom, or a query refetches | only via `dispatch(msg)` -> `update` |
| Server state (fetch, cache, refresh) | **great**: `AsyncResult`, `reactivityKeys`, auto-refresh | manual: you write the Loading/Loaded/Failed and the refetch |
| Fine-grained re-render | **great**: a component re-renders only for atoms it reads | coarse: the view gets the whole model (fine for small pages) |
| Complex UI state machines (wizards, multi-step forms, drag & drop) | gets tangled across atoms | **great**: every transition is one `case` in update |
| "How did we get here?" | read every place that writes the atom | **read the message log** |
| Testing | needs an atom registry, often a fake client | **call `update`**, assert on the returned model |
| Replay / time travel | not built in | free: messages are data |
| Boilerplate | low | higher (a Msg per event) |
| Cancellation on unmount | automatic (atom has no readers) | automatic (Scope closes) |

**Rule of thumb:** server data and lots of independent widgets -> atoms. One screen with tricky rules about which
event is allowed when -> TEA. They mix fine: a TEA program can live inside one component of an atom-based app.

## Where this repo uses it

- Runtime: `src/features/todos/client-tea/tea.ts` (`program`, `Cmd`, `Sub`, `replay`)
- The todos program: `src/features/todos/client-tea/todosTea.ts`
- React binding: `src/features/todos/client-tea/useTea.ts`
- Page: `src/app/todos-tea/`
- The atom version to compare with: `src/features/todos/client/todosAtoms.ts`, `src/app/todos/TodosApp.tsx`

## Self-check

1. Why is `update` not allowed to call `fetch`? (Answer: it would no longer be pure, so it couldn't be replayed or
   tested by value. It returns a `Cmd` describing the fetch instead.)
2. You click "Turn off" on the live feed. Which code closes the `EventSource`? (Answer: `subscriptions(model)` no
   longer returns the `live-feed` key, the runtime interrupts that fiber, and the `acquireRelease` finalizer runs.)
3. Two messages from two Cmds arrive "at the same time". Can `update` see a half-applied model? (Answer: no. Dispatch
   processes one message at a time; a message emitted during an update is queued.)
4. You need a cached, auto-refreshing list shared by five unrelated components. Atoms or TEA? (Answer: atoms.)
