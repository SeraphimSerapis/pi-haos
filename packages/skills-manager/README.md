# Skills manager

The skills manager stores skills outside Home Assistant `/config` and treats
manifests as untrusted input. Bundled skills are immutable from the UI;
installed and user-authored skills are versioned, validated, and removable.
Remote fetching is intentionally left to a later milestone.

Milestone 6 will implement manifest validation, policy checks, storage, and
rollback for bundled and user-authored skills.
