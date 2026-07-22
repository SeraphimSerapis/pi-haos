# Security model

The default capability policy is read-only. The model cannot call arbitrary
shell, arbitrary HTTP, Supervisor endpoints, or direct mutation functions.
Pi's built-in tools are disabled. Backend code—not prompts—enforces every
capability through a per-session, loopback broker token and records every
decision.

The live configuration is mounted read-only. App-private sessions, credentials,
skills, transaction snapshots, logs, and databases are under `/data`, never
under `/config`. Pi receives a scrubbed environment and no Supervisor token.
The Pi runtime now launches through a fail-closed Landlock sandbox; AppArmor is
an additional container-wide control, not a substitute for process isolation.

Threats include prompt injection in configuration, malicious skills, hostile
providers, compromised Pi packages, and malformed tool calls. Mitigations are
typed tools, an explicit tool-name allowlist, path allowlists, redaction,
size/time limits, one-time pairing
with a stored integration token, immutable snapshots, hash conflict
detection, workspace scanner limits, no-follow regular-file reads, validation,
rollback, and an append-only audit trail.

Known limitation: local file permissions and encryption at rest cannot protect
data from a fully compromised App container or Home Assistant host. This is
documented and tested as an operational trust assumption.
