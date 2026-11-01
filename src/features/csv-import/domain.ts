// ─────────────────────────────────────────────────────────────────────────────
// CSV IMPORT: the shapes. A row is validated by a Schema (strings in, typed values out), and the import reports
// its progress as a small set of tagged events that the route sends to the browser over SSE.
// ─────────────────────────────────────────────────────────────────────────────
import { Schema } from "effect"

// Header: name,email,age
export const ContactRow = Schema.Struct({
  name: Schema.NonEmptyString,
  email: Schema.String.check(Schema.isPattern(/^[^@\s]+@[^@\s]+$/)),
  age: Schema.FiniteFromString.check(Schema.isGreaterThanOrEqualTo(0)),
})
export type ContactRow = typeof ContactRow.Type

export type ImportEvent =
  | { readonly _tag: "BatchInserted"; readonly size: number; readonly inserted: number }
  | { readonly _tag: "RowRejected"; readonly line: number; readonly reason: string }
  | { readonly _tag: "Done"; readonly inserted: number; readonly rejected: number }
