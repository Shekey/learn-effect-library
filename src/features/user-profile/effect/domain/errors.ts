// ─────────────────────────────────────────────────────────────────────────────
// PROBLEM: `throw new Error("not found")` is invisible in types and can only be told apart with instanceof/strings.
// EFFECT WAY: Schema.TaggedError creates an error class that
//   - has a literal `_tag` ("NotFoundError") so `Effect.catchTags` can match it and the compiler checks coverage,
//   - is yieldable: `return yield* new NotFoundError({...})` fails the current Effect,
//   - is serializable (Schema), so it can cross process boundaries.
// DON'T: use plain `Error`/strings as failures, or `Effect.die` for things callers should handle.
// ─────────────────────────────────────────────────────────────────────────────
import { Schema } from "effect"

// Typed, tagged errors: they show up in Effect's error channel and can be matched by _tag.
export class NotFoundError extends Schema.TaggedError<NotFoundError>()("NotFoundError", {
  resource: Schema.String,
}) {}

export class UpstreamError extends Schema.TaggedError<UpstreamError>()("UpstreamError", {
  message: Schema.String,
}) {}

export class InvalidResponseError extends Schema.TaggedError<InvalidResponseError>()("InvalidResponseError", {
  message: Schema.String,
}) {}

export class UserBannedError extends Schema.TaggedError<UserBannedError>()("UserBannedError", {
  userId: Schema.Int,
}) {}
