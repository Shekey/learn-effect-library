// Usage: pnpm lesson 02              (runs the lesson numbered 02, wherever it lives)
//        pnpm lesson beginner/02     (same, with the level spelled out)
//        pnpm lesson                 (lists lessons grouped by level)
import { readdirSync } from "node:fs"
import { join } from "node:path"
import { Effect } from "effect"

// Load .env.local like Next.js does (DATABASE_URL for lesson 19). Missing file = fine, lessons have defaults.
try {
  process.loadEnvFile(join(__dirname, "../../.env.local"))
} catch {}

const levels = ["beginner", "intermediate", "advanced"] as const
const lessons = levels.flatMap((level) =>
  readdirSync(join(__dirname, level))
    .filter((f) => /^\d\d-.*\.ts$/.test(f))
    .sort()
    .map((file) => ({ level, file, id: `${level}/${file}` }))
)
const wanted = process.argv[2]

if (!wanted) {
  console.log(
    levels
      .map((level) => `${level}\n` + lessons.filter((l) => l.level === level).map((l) => "  " + l.file).join("\n"))
      .join("\n\n") + "\n\nRun one: pnpm lesson 02",
  )
} else {
  const lesson = wanted.includes("/")
    ? lessons.find((l) => l.id.startsWith(wanted.replace(/\/(\d)(?!\d)/, "/0$1")))
    : lessons.find((l) => l.file.startsWith(wanted.padStart(2, "0") + "-"))
  if (!lesson) throw new Error(`No lesson "${wanted}"`)
  // Every lesson exports `main: Effect<void>`. THIS is the edge of the program, so runPromise is fine here.
  import(`./${lesson.id}`).then(({ main }) => Effect.runPromise(main)).catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
