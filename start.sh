#!/bin/bash
# DJEN Monitor - Startup script
# Logs detalhados antes de iniciar o node

set +e  # Nao para em erros para vermos tudo

echo "==========================================="
echo "  DJEN Monitor - Startup Wrapper"
echo "==========================================="
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "PWD: $(pwd)"
echo "User: $(whoami)"
echo "Node: $(node --version 2>&1 || echo 'node not found')"
echo "Bash: ${BASH_VERSION}"
echo ""
echo "ENV VARS:"
echo "  PORT: ${PORT:-NOT SET}"
echo "  NODE_ENV: ${NODE_ENV:-NOT SET}"
echo "  LOG_LEVEL: ${LOG_LEVEL:-NOT SET}"
echo "  DATABASE_URL: ${DATABASE_URL:+configured}"
echo "  DATABASE_URL length: ${#DATABASE_URL}"
echo "  ENABLE_CRON: ${ENABLE_CRON:-NOT SET}"
echo "==========================================="
echo ""

echo "[WRAPPER] Listing /app contents:"
ls -la /app 2>&1 || echo "Cannot list /app"
echo ""

echo "[WRAPPER] Checking dist/server.js:"
if [ -f "/app/dist/server.js" ]; then
  echo "[WRAPPER] /app/dist/server.js OK ($(stat -c%s /app/dist/server.js) bytes)"
else
  echo "[WRAPPER] FATAL: /app/dist/server.js NOT FOUND"
  exit 1
fi
echo ""

echo "[WRAPPER] Checking node_modules:"
if [ -d "/app/node_modules" ]; then
  echo "[WRAPPER] /app/node_modules OK ($(ls /app/node_modules | wc -l) packages)"
else
  echo "[WRAPPER] FATAL: /app/node_modules NOT FOUND"
  exit 1
fi
echo ""

echo "[WRAPPER] Checking prisma client:"
if [ -d "/app/node_modules/.prisma/client" ]; then
  echo "[WRAPPER] Prisma client OK"
else
  echo "[WRAPPER] WARNING: Prisma client not found"
fi
echo ""

echo "[WRAPPER] Executing: node dist/server.js"
echo "==========================================="
exec node /app/dist/server.js 2>&1
