# Development

Install Node.js 24 and pnpm 10, then run `pnpm install` followed by the lint,
typecheck, test, and build commands in the root README. Compose approximates the
production App with a read-only fixture mounted at `/homeassistant`, a private
named `/data` volume, a read-only container filesystem, dropped capabilities,
and `no-new-privileges`.

The repository currently cannot initialize `.git` in the managed workspace;
create the Git repository in a normal writable checkout before committing.
