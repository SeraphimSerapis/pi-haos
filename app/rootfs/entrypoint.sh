#!/bin/sh
set -eu
# Supervisor may mount options.json with permissions that intentionally do
# not grant the image user access. Configuration is therefore best-effort;
# validated defaults keep startup working in rootless environments.
if [ -r /data/options.json ]; then
  configured_log_level="$(node -e "const o=require('/data/options.json'); process.stdout.write(String(o.log_level || 'info'))")"
  case "$configured_log_level" in
    trace|debug|info|warn|error) export LOG_LEVEL="$configured_log_level" ;;
    *) export LOG_LEVEL=info ;;
  esac
  configured_pi_updates="$(node -e "const o=require('/data/options.json'); process.stdout.write(o.independent_pi_updates === true ? 'true' : 'false')")"
  export PI_UPDATES_ENABLED="$configured_pi_updates"
  configured_diagnostics="$(node -e "const o=require('/data/options.json'); process.stdout.write(o.diagnostics === true ? 'true' : 'false')")"
  export DIAGNOSTICS_ENABLED="$configured_diagnostics"
fi
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
if [ "$(id -u)" = "0" ]; then
  exec setpriv --reuid=10001 --regid=10001 --init-groups \
    node /app/backend/dist/server.js
fi
exec node /app/backend/dist/server.js
