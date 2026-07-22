#!/bin/sh
set -eu
mkdir -p /data/database /data/sessions /data/transactions /data/skills /data/pi /data/logs
if [ -d /app/bundled-skills ]; then
  for skill in /app/bundled-skills/*; do
    [ -d "$skill" ] || continue
    target="/data/skills/bundled/$(basename "$skill")"
    if [ ! -e "$target" ]; then
      cp -R "$skill" "$target"
    fi
  done
fi
exec node /app/backend/dist/server.js
