#!/bin/sh
set -eu
# Supervisor protects /data/options.json from the App process on this HAOS
# runtime. Use safe defaults here; option plumbing must use a supported API
# rather than weakening the data-volume boundary.
export LOG_LEVEL=info
export PI_UPDATES_ENABLED=false
export DIAGNOSTICS_ENABLED=false
mkdir -p /data/database /data/sessions /data/transactions \
  /data/skills/bundled /data/skills/installed /data/skills/disabled /data/skills/metadata \
  /data/pi /data/logs 2>/dev/null || true
if [ -d /app/bundled-skills ]; then
  for skill in /app/bundled-skills/*; do
    [ -d "$skill" ] || continue
    target="/data/skills/bundled/$(basename "$skill")"
    if [ ! -e "$target" ] && [ -w /data/skills/bundled ]; then
      cp -R "$skill" "$target" 2>/dev/null || true
    fi
  done
fi
exec node /app/backend/dist/server.js
