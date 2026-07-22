# Transaction model

Transactions move through:

`created → planning → staging → awaiting_review → approved → validating → applying → post_apply_validation → completed`

Failures are `rejected`, `failed`, `rolled_back`, `cancelled`, or `conflicted`.
The agent only writes to an isolated staging directory. The backend records
original hashes and produces a file-level diff. A user approves individual
files, validation runs, and the paired integration receives complete replacement
contents plus expected hashes. The integration rechecks live hashes and uses
same-directory temporary files and atomic renames. The backend retains original
snapshots and a recovery journal so an interrupted apply can be rolled back.

Never mutate `secrets.yaml`, `.storage/**`, `.cloud/**`, databases, logs,
`.HA_VERSION`, or other non-allowlisted paths. `custom_components/**` is an
explicit advanced opt-in and is denied by default.
