#!/bin/sh
set -eu
mkdir -p /data/database /data/sessions /data/transactions /data/skills /data/pi /data/logs
exec node /app/backend/dist/server.js
