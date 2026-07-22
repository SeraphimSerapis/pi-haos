# Pi update strategy

The image contains `@earendil-works/pi-coding-agent@0.81.1`, the exact tested
baseline selected from Pi's published npm distribution. It is installed with
`--ignore-scripts`; its npm registry integrity metadata is recorded in the
release manifest. Later releases are installed under `/data/pi/versions/<version>` with exact package metadata, registry
integrity verification, lifecycle scripts disabled, a capability probe, and a
mock-provider smoke test. Activation changes an atomic pointer only while all
sessions and transactions are idle. The previous version is retained for
rollback; failed health checks automatically restore it. The App persists
`stable`/`pinned` channel selection, enablement, last-check metadata, latest
version, compatibility, and release notes under `/data/pi`. Independent
updates default to disabled and unattended updates are out of scope for the
MVP. The backend now provides an explicit, read-only stable-channel catalog
check against npm metadata. It accepts only HTTPS tarballs from the configured
registry host and valid SHA-512 integrity metadata; it does not download,
install, or execute a release. When independent updates are explicitly
enabled on the stable channel, the Settings view can request installation:
the installer downloads the tarball, verifies SHA-512 SRI, validates archive
paths, extracts into a private workspace, rejects symlinks through the package
scanner, runs the smoke test, and stages the version. It never activates the
version automatically; activation still requires an idle runtime and explicit
confirmation.
