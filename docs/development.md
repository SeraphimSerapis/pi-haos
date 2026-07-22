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

The Ingress frontend is terminal-first. A single authenticated WebSocket
session launches Pi in an isolated staging workspace through the existing
sandbox launcher. The terminal is not a general-purpose shell: Pi is started
with built-in shell tools disabled and Home Assistant tools are brokered by the
backend. Terminal input and output are bounded and only one interactive
terminal session is allowed at a time.

The repository is a normal Git checkout. Keep commits small and run all quality
gates before pushing.

The production Docker build compiles `packages/pi-runtime/src/pi-sandbox.c`
inside the Debian builder image. The launcher requires Landlock ABI 4 and
refuses to execute Pi when that kernel capability is unavailable.
