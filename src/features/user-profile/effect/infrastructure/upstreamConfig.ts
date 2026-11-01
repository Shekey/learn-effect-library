import { Config } from "effect"

// Typed, validated, defaulted env config. A bad value (UPSTREAM_RETRIES=abc) fails when the layer is built, not mid-request.
export const UpstreamConfig = Config.all({
  baseUrl: Config.String("UPSTREAM_URL").pipe(Config.withDefault("http://localhost:3000")),
  timeoutMs: Config.Int("UPSTREAM_TIMEOUT_MS").pipe(Config.withDefault(1500)),
  retries: Config.Int("UPSTREAM_RETRIES").pipe(Config.withDefault(3)),
})
