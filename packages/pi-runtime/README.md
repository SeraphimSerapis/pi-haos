# Pi runtime

This package is the boundary between the backend and Pi. It exposes a stable
`PiRuntime` interface while the implementation talks to Pi over JSONL RPC.
Sessions are supervised child processes; stdout is parsed with a byte limit,
malformed events fail the session, and process exits make health checks fail.

The child is launched through `pi-sandbox`, a small Linux launcher that applies
Landlock filesystem and network rules before executing Pi. It receives access
only to its assigned workspace, runtime libraries, temporary files, and the
configured local inference-broker port. If the required Landlock ABI or
launcher is unavailable, the runtime refuses to start the session.

The image currently bundles the pinned `@earendil-works/pi-coding-agent@0.81.1`
CLI. The mock runtime remains deterministic and is used by unit tests; the
production backend wiring will select the bundled CLI through the runtime
supervisor once the provider/session policy is enabled.
