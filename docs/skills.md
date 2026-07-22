# Skills

Skills are Agent Skills-compatible directories stored under `/data/skills`.
Bundled skills are immutable and user skills are text/reference-only in the
MVP; executable scripts and remote installation require a later reviewed
capability. A manifest may request permissions, but the backend policy decides
whether those permissions are available. Skill content is untrusted input and
is never a security boundary.
