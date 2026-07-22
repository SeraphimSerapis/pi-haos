# Home Assistant client

This package provides the backend-only Home Assistant REST boundary. It keeps
the Supervisor token in the process, applies request timeouts, and exposes
typed read-only methods for runtime context. Local configuration reads use a
separate path policy that rejects protected directories, traversal, and
non-regular files, then redacts common secret values.

WebSocket event subscriptions and write-capable integration calls remain
intentionally separate milestones.
