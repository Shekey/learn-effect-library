// ─────────────────────────────────────────────────────────────────────────────
// COMPOSITION ROOT for the CSV import mini feature. Deliberately its OWN tiny runtime: this feature is a
// lesson-24 demo and should not depend on (or change) the todos / user-profile runtimes.
// Swap RowSink.memory for a SQL layer and nothing else changes.
// ─────────────────────────────────────────────────────────────────────────────
import { ManagedRuntime } from "effect"
import { RowSink } from "./rowSink"

// Next dev reloads modules on every edit; keep one runtime per process so the in-memory store survives.
const g = globalThis as unknown as { __csvImportRuntime?: ManagedRuntime.ManagedRuntime<RowSink, never> }
export const csvImportRuntime = (g.__csvImportRuntime ??= ManagedRuntime.make(RowSink.memory))
