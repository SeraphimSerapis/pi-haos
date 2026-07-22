# Development guide

This is a pnpm TypeScript monorepo containing a Home Assistant OS App and a
companion custom integration. The repository is intentionally safe by default:
the App's `/homeassistant` mount is read-only and mutation authority belongs to
the paired integration, which is not implemented in Milestone 1.

Run `pnpm install`, then `pnpm lint`, `pnpm typecheck`, `pnpm test`, and
`pnpm build`. Use `pnpm dev` for the backend and `pnpm --filter
@pi-ha/frontend dev` for the frontend. Do not add secrets, generated output,
or private Home Assistant state to the repository.
