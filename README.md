# Pi Home Assistant Agent

An experimental Home Assistant OS App that brings the Pi agent into a native
Home Assistant sidebar panel. Pi will be able to understand a Home Assistant
instance through typed, auditable tools while keeping live configuration safe:
inspection is read-only, changes are staged and reviewable, and an explicitly
paired companion integration owns approved writes.

## Status

The repository now provides a health-checked Home Assistant App, an Ingress
frontend with Chat, Models, and Skills views, a pinned Pi `0.81.1` runtime,
supervised JSONL RPC sessions, read-only Home Assistant context routes,
validated skills, transaction safety primitives, and a fail-closed Landlock
sandbox. The companion integration exposes the authenticated service contract;
live transaction application and full structured-tool wiring remain next
milestones.

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
