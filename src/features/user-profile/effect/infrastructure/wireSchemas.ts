import { Schema, SchemaGetter } from "effect"

// ─────────────────────────────────────────────────────────────────────────────
// PROBLEM: the upstream speaks its own dialect (snake_case, "A"/"B" codes). If that leaks into the app,
//          every layer has to know about it, and TypeScript types lie (JSON.parse returns `any`).
// EFFECT WAY: a Schema describes the wire shape AND how to turn it into our domain shape, in ONE place.
//             `Schema.decodeTo` = validate + map on the way in; `encode` = reverse mapping on the way out.
// DON'T: write `interface UserWire` + `isUserWire()` + `toUser()` separately (see standard/infrastructure).
//        Three hand-written things drift apart silently.
// ─────────────────────────────────────────────────────────────────────────────

export const UserFromWire = Schema.Struct({
  user_id: Schema.Int,
  full_name: Schema.NonEmptyString,
  state: Schema.Literals(["A", "B"]),
}).pipe(
  Schema.decodeTo(
    Schema.Struct({ id: Schema.Int, name: Schema.NonEmptyString, status: Schema.Literals(["active", "banned"]) }),
    {
      decode: SchemaGetter.transform((w) => ({
        id: w.user_id,
        name: w.full_name,
        status: w.state === "A" ? ("active" as const) : ("banned" as const),
      })),
      encode: SchemaGetter.transform((u) => ({
        user_id: u.id,
        full_name: u.name,
        state: u.status === "active" ? ("A" as const) : ("B" as const),
      })),
    },
  ),
)

// Pure key renames need no transformation code at all.
export const PostFromWire = Schema.Struct({ id: Schema.Int, userId: Schema.Int, title: Schema.String }).pipe(
  Schema.encodeKeys({ id: "post_id", userId: "author_id" }),
)
