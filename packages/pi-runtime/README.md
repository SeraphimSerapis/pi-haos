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

The mock runtime is deterministic and is used by backend tests until a real Pi
package and provider fixture are available.
