# Development

Install Node.js 24 and pnpm 10, then run `pnpm install` followed by the lint,
typecheck, test, and build commands in the root README. Compose approximates the
production App with a read-only fixture mounted at `/homeassistant`, a private
named `/data` volume, a read-only container filesystem, dropped capabilities,
and `no-new-privileges`. It is useful for checking the App HTTP surface and
persistence, but it cannot prove Home Assistant Core API semantics or
companion integration behavior.

The repository is a normal Git checkout. Keep commits small and run all quality
gates before pushing.

The production Docker build compiles `packages/pi-runtime/src/pi-sandbox.c`
inside the Debian builder image. The launcher requires Landlock ABI 4 and
refuses to execute Pi when that kernel capability is unavailable.
