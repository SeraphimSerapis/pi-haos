# Pi Home Assistant Agent

An experimental Home Assistant OS App that brings the Pi agent into a native
Home Assistant sidebar panel. Pi will be able to understand a Home Assistant
instance through typed, auditable tools while keeping live configuration safe:
inspection is read-only, changes are staged and reviewable, and an explicitly
paired companion integration owns approved writes.

## Status

Milestone 1 (foundation) is in progress. The current slice provides a
health-checked backend, an Ingress-compatible frontend shell, App packaging,
development Compose setup, shared contracts, and CI scaffolding. Pi sessions,
Home Assistant tools, transactions, and the companion integration are planned
for subsequent milestones.

## Development

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker compose -f docker-compose.dev.yml up --build
```

Open `http://localhost:8099/` for the local frontend. The production App uses
Home Assistant Ingress and maps the live configuration read-only at
`/homeassistant`; private state is stored under `/data`.

See `docs/architecture.md`, `docs/security-model.md`, and
`docs/transaction-model.md` for the design boundaries.
