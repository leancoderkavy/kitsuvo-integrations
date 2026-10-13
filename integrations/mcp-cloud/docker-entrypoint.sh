#!/bin/sh
set -eu
# Only volume ownership initialization runs as root. The relay runs as node.
mkdir -p /data
chown node:node /data
chmod 700 /data
if [ -f /data/authorization.json ]; then
  chown node:node /data/authorization.json
  chmod 600 /data/authorization.json
fi
exec su-exec node "$@"
