// LESSON 9 (intermediate): Schema: validate untrusted data and map it, from one definition.
//
// PROBLEM: JSON from the outside is `any`. Plain TS needs a type, a guard, and a mapper, written separately
//   (they drift). `JSON.parse(x) as User` is a lie the compiler believes.
// EFFECT WAY: describe the shape ONCE. You get: the TS type, a validator, a decoder with readable errors, and
//   (with decodeTo) a mapping wire -> domain that can also encode back.
//
// WHEN: every boundary: HTTP responses, request bodies, env vars, DB rows, queue messages.
// DON'T: `JSON.parse(x) as User`. DON'T hand-write guards for each field.
import { Effect, Schema, SchemaGetter } from "effect"

const section = (title: string) => Effect.sync(() => console.log(`\n── ${title} ──`))

// ── The regular way ──────────────────────────────────────────────────────────
// Three separate pieces that must be kept in sync by hand.
type RegularUser = { id: number; name: string } // 1. the type

const isRegularUser = (x: unknown): x is RegularUser => // 2. the guard
  typeof x === "object" && x !== null &&
  Number.isInteger((x as RegularUser).id) &&
  typeof (x as RegularUser).name === "string" && (x as RegularUser).name.length > 0

const regularFromWire = (w: { user_id: number; full_name: string }): RegularUser => // 3. the mapper
  ({ id: w.user_id, name: w.full_name.trim() })

const regularWay = () => {
  console.log("1. valid?", isRegularUser({ id: 1, name: "Ada" }))
  console.log("2. invalid?", isRegularUser({ id: "x", name: "" }), "(but WHY? the guard can't say)")
  console.log("3. mapped:", regularFromWire({ user_id: 7, full_name: "  Grace " }))
}

// ── The Effect way ───────────────────────────────────────────────────────────
const User = Schema.Struct({ id: Schema.Int, name: Schema.NonEmptyString })
type User = typeof User.Type // the TS type comes FROM the schema

const decodeUser = Schema.decodeUnknownEffect(User)

// Wire format -> domain format, reversible. (Optional for beginners; skip if short on time.)
const WireUser = Schema.Struct({ user_id: Schema.Int, full_name: Schema.String })
const UserFromWire = WireUser.pipe(
  Schema.decodeTo(User, {
    decode: SchemaGetter.transform((wire) => ({ id: wire.user_id, name: wire.full_name.trim() })),
    encode: SchemaGetter.transform((user) => ({ user_id: user.id, full_name: user.name })),
  }),
)

const effectWay = Effect.gen(function*() {
  const ada: User = yield* decodeUser({ id: 1, name: "Ada" })
  console.log("1. valid:", ada)

  // Invalid input becomes a typed failure with a readable, path-aware message.
  const bad = yield* Effect.result(decodeUser({ id: "x", name: "" }))
  if (bad._tag === "Failure") console.log("2. invalid, because:", String(bad.failure))

  const grace = yield* Schema.decodeUnknownEffect(UserFromWire)({ user_id: 7, full_name: "  Grace " })
  console.log("3. wire -> domain:", grace)
  console.log("4. domain -> wire:", yield* Schema.encodeEffect(UserFromWire)(grace))
})

export const main = Effect.gen(function*() {
  yield* section("regular way (type + guard + mapper)")
  regularWay()

  yield* section("Effect way (one Schema)")
  yield* effectWay

  // YOUR TURN: add `email: Schema.String` to User. Which places do you have to update? Compare with the regular way.
})
