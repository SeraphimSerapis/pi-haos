# Pi Home Assistant Agent

An experimental Home Assistant OS App that brings the Pi agent into a native
Home Assistant sidebar panel. Pi will be able to understand a Home Assistant
instance through typed, auditable tools while keeping live configuration safe:
inspection is read-only, changes are staged and reviewable, and an explicitly
paired companion integration owns approved writes.

## Status

The repository now provides a health-checked Home Assistant App, an Ingress
frontend with Chat, Changes, Tasks, Models, Skills, Audit, and Settings views, a
pinned Pi `0.81.1` runtime, supervised JSONL RPC sessions, read-only Home
Assistant context routes, validated skills, persistent SQLite task metadata,
isolated Pi task runs, reviewable workspace-to-transaction manifests, atomic
apply with rollback reporting, explicit activation controls, model defaults,
verified Pi staging, and a fail-closed Landlock/AppArmor boundary. The
companion integration exposes authenticated task, status, and transaction
services. Live Home Assistant runtime verification remains outstanding.

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
Model provider and default-selection behavior is described in
`docs/models.md`.
