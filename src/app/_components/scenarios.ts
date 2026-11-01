// Everything the audience needs to understand ONE test, in plain words.
export interface Scenario {
  id: number
  title: string
  tagline: string
  tests: string // what is being tested
  watch: string // what to look at
  expect: number // expected HTTP status
  files: string[]
}

export const scenarios: Scenario[] = [
  {
    id: 3,
    title: "Happy path",
    tagline: "user 3",
    tests: "Fetch a user and their posts in parallel, apply the business rule, return a clean DTO.",
    watch: "Both return identical JSON. The upstream is flaky (40% random 500s), so timing varies: that is retry at work.",
    expect: 200,
    files: ["effect/application/getUserProfile.ts", "standard/application/getUserProfile.ts"],
  },
  {
    id: 5,
    title: "Domain rule",
    tagline: "user 5 is banned",
    tests: "A business rule rejects banned users. How is that failure represented and handled?",
    watch: "Both answer 403. In Effect the error is part of the function type, so the route cannot forget to handle it.",
    expect: 403,
    files: ["effect/domain/errors.ts", "app/api/effect/profile/[id]/route.ts"],
  },
  {
    id: 999,
    title: "Not found",
    tagline: "user 999 does not exist",
    tests: "The upstream returns 404. A 404 must NOT be retried, it will never succeed.",
    watch: "Both answer 404 almost instantly (no retry delay). Effect's retry only targets transient errors.",
    expect: 404,
    files: ["effect/infrastructure/upstreamHttp.ts"],
  },
  {
    id: 13,
    title: "Hanging upstream",
    tagline: "user 13 never answers",
    tests: "The upstream hangs. We need a deadline, and the hanging request must be cancelled, not leaked.",
    watch: "Both give up with 504 after ~1.5s. Effect interrupts the in-flight request automatically.",
    expect: 504,
    files: ["effect/infrastructure/upstreamHttp.ts", "standard/infrastructure/httpUserClient.ts"],
  },
]
