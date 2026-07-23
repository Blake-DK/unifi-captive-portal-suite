#!/bin/sh
set -e

echo "Running Prisma migrations..."
# Direct binary, not npx: the runtime image ships no npm (its bundled deps
# kept tripping the weekly image scan; the prisma-cli closure has .bin).
node_modules/.bin/prisma migrate deploy

echo "Starting Next.js..."
# Standalone server (next.config.mjs output: "standalone"); binds
# PORT/HOSTNAME from the Dockerfile env instead of `next start -p 80`.
exec node server.js
