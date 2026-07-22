#!/bin/sh
set -eu
if [ -f /data/options.json ]; then
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
mkdir -p /data/database /data/sessions /data/transactions /data/skills /data/pi /data/logs
chown -R pi-agent:pi-agent /data/database /data/sessions /data/transactions /data/skills /data/pi /data/logs
if [ -d /app/bundled-skills ]; then
  for skill in /app/bundled-skills/*; do
    [ -d "$skill" ] || continue
    target="/data/skills/bundled/$(basename "$skill")"
    if [ ! -e "$target" ]; then
      cp -R "$skill" "$target"
    fi
  done
fi
exec setpriv --reuid=10001 --regid=10001 --init-groups \
  node /app/backend/dist/server.js
