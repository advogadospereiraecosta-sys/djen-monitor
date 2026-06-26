#!/bin/sh
# DJEN Monitor - Startup script
# Logs detalhados antes de iniciar o node

echo "==========================================="
echo "  DJEN Monitor - Startup Wrapper"
echo "==========================================="
echo "Date: $(date)"
echo "PWD: $(pwd)"
echo "User: $(whoami)"
echo "Node: $(node --version)"
echo "PORT: ${PORT:-not set}"
echo "NODE_ENV: ${NODE_ENV:-not set}"
echo "DATABASE_URL: ${DATABASE_URL:+configured (hidden)}"
echo "DATABASE_URL length: ${#DATABASE_URL}"
echo "==========================================="
echo ""

# Verifica se dist/server.js existe
echo "[WRAPPER] Verifying dist/server.js..."
if [ -f "dist/server.js" ]; then
  echo "[WRAPPER] dist/server.js OK ($(stat -c%s dist/server.js) bytes)"
else
  echo "[WRAPPER] FATAL: dist/server.js NOT FOUND"
  echo "[WRAPPER] dist/ contents:"
  ls -la dist/
  exit 1
fi
echo ""

# Verifica node_modules
echo "[WRAPPER] Verifying node_modules..."
if [ -d "node_modules" ]; then
  echo "[WRAPPER] node_modules OK"
else
  echo "[WRAPPER] FATAL: node_modules NOT FOUND"
  exit 1
fi
echo ""

# Inicia o servidor
echo "[WRAPPER] Starting node dist/server.js..."
echo "==========================================="
exec node dist/server.js 2>&1
