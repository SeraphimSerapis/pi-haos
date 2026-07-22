# Transaction model

Transactions move through:

`created → planning → staging → awaiting_review → approved → validating → applying → post_apply_validation → completed`

Failures are `rejected`, `failed`, `rolled_back`, `cancelled`, or `conflicted`.
The agent writes only to an isolated staging directory. The backend scanner
rejects symlinks, protected paths, oversized files, and workspace escapes;
compares staged content with the read-only live configuration; and emits a
review manifest with original hashes and a diff hash. The task API persists
lifecycle and approval metadata, while review manifests are currently held by
the transaction store for the running App process. After file-level approval
and
validation, the companion integration fetches the approved manifest by
transaction ID over the integration token. This keeps the App authoritative
for staged contents without putting a large write payload in a Home Assistant
service call.

The integration rechecks live hashes and uses same-directory temporary files
and atomic renames. It retains original snapshots and restores them when a
write or validation callback fails. Post-apply Home Assistant Core validation
and reload approval still require a live Home Assistant test harness.

Never mutate `secrets.yaml`, `.storage/**`, `.cloud/**`, databases, logs,
`.HA_VERSION`, or other non-allowlisted paths. `custom_components/**` is an
explicit advanced opt-in and is denied by default.
