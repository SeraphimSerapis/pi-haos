# Architecture

The App is a local, Ingress-served control plane. The backend owns sessions,
policy, task metadata, audit records, staging, and Home Assistant API access.
Task metadata is persisted in SQLite under `/data`; task creation and bounded
approval actions are available to the Ingress UI and authenticated companion
bridge. Pi is a
supervised RPC worker and receives only narrowly scoped typed tools through the
loopback structured-tool broker. The live
`/homeassistant` mount is read-only. Approved file mutations are delegated to a
paired `pi_homeassistant_agent` custom integration, which runs in Home
Assistant Core and is the trusted write boundary.

```mermaid
flowchart LR
  UI[Home Assistant Ingress UI] --> API[Fastify backend]
  API --> DB[(SQLite under /data)]
  API --> Policy[Capability policy under /data]
  API --> HA[HA REST/WebSocket proxy]
  API -->|session-token protected broker| Broker[Structured tool broker]
  Broker --> PI[Pi RPC worker + Landlock sandbox]
  PI -->|typed read-only calls| Broker
  PI -->|inference proxy| Provider[Configured model provider]
  API --> Stage[Staging workspaces]
  API -->|approved manifest| Integration[Companion integration]
  Integration --> Config[/config atomic apply]
```

The App container uses no host networking, privileged mode, Docker socket, or
host mounts. App packaging follows the current Home Assistant App contract;
`build.yaml` is deliberately omitted because current builders no longer use it.

Pi is launched with built-in tools disabled and the bundled extension at
`app/pi-tools/ha-tools.ts`. That extension can call only the named broker tools;
the backend maps each name to one Home Assistant client method, validates and
redacts inputs, and authenticates the call with a per-session token. The token
is never returned to the Ingress browser or passed as a Supervisor credential.
Capability policy updates are backend-enforced and immediately replace the
broker policy for subsequent tool calls.

The companion integration routes reload and restart requests through the
authenticated bridge. The bridge accepts only the fixed automation, script,
scene, template, and Home Assistant restart actions; it requires explicit
confirmation, re-validates Core configuration, and records the action.
