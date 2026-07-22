# Architecture

The App is a local, Ingress-served control plane. The backend owns sessions,
policy, task metadata, audit records, staging, and Home Assistant API access.
Task metadata is persisted in SQLite under `/data`; task creation and bounded
approval actions are available to the Ingress UI and authenticated companion
bridge. Pi is a
supervised RPC worker and receives only narrowly scoped typed tools. The live
`/homeassistant` mount is read-only. Approved file mutations are delegated to a
paired `pi_homeassistant_agent` custom integration, which runs in Home
Assistant Core and is the trusted write boundary.

```mermaid
flowchart LR
  UI[Home Assistant Ingress UI] --> API[Fastify backend]
  API --> DB[(SQLite under /data)]
  API --> HA[HA REST/WebSocket proxy]
  API -->|typed local IPC| PI[Pi RPC worker + Landlock sandbox]
  PI -->|inference proxy| Provider[Configured model provider]
  API --> Stage[Staging workspaces]
  API -->|approved manifest| Integration[Companion integration]
  Integration --> Config[/config atomic apply]
```

The App container uses no host networking, privileged mode, Docker socket, or
host mounts. App packaging follows the current Home Assistant App contract;
`build.yaml` is deliberately omitted because current builders no longer use it.
