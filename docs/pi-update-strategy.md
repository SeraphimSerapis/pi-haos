# Pi update strategy

The image contains one exact, tested Pi version. Later releases are installed
under `/data/pi/versions/<version>` with exact package metadata, registry
integrity verification, lifecycle scripts disabled, a capability probe, and a
mock-provider smoke test. Activation changes an atomic pointer only while all
sessions and transactions are idle. The previous version is retained for
rollback; failed health checks automatically restore it. Independent updates
default to disabled and unattended updates are out of scope for the MVP.
