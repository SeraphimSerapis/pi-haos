# Transaction engine

This package contains the policy and state-machine core for staged Home
Assistant configuration changes. It is deliberately independent of the App
filesystem and Home Assistant integration bridge: the backend can stage and
review changes while a narrowly scoped apply port owns live writes.

Milestone 4 will implement staging, diffs, validation, approval, atomic apply,
rollback, and audit records.
