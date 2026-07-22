# Development

Install Node.js 24 and pnpm 10, then run `pnpm install` followed by the lint,
typecheck, test, and build commands in the root README. Compose approximates the
production App with a read-only fixture mounted at `/homeassistant`, a private
named `/data` volume, a read-only container filesystem, dropped capabilities,
and `no-new-privileges`. It is useful for checking the App HTTP surface and
persistence, but it cannot prove Home Assistant Core API semantics or
companion integration behavior.

The production App uses the Home Assistant Community Debian base image, which
provides s6 and bashio. The `pi-agent` s6 service reads the declared
`log_level`, `diagnostics`, and `independent_pi_updates` options through
`bashio::config` and exports only bounded environment settings to the Node
backend. The Node process never reads `/data/options.json` directly.

Home Assistant Ingress opens `ttyd`, which renders Pi's native interactive TUI
directly. This is the same deployment pattern used by the SSH App: the App
does not implement a browser terminal or translate terminal input into a custom
web UI. Each connection gets an isolated staging workspace through the
Landlock sandbox launcher. The live `/homeassistant` mount remains read-only.

The Fastify frontend/API remains available on the internal port for health,
structured tools, the companion integration, and future review screens; it is
not the primary Ingress surface.

The repository is a normal Git checkout. Keep commits small and run all quality
gates before pushing.

The production Docker build compiles `packages/pi-runtime/src/pi-sandbox.c`
inside the Debian builder image. The launcher requires Landlock ABI 4 and
refuses to execute Pi when that kernel capability is unavailable.
