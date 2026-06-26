# ===========================================
# DJEN Monitor - Dockerfile Final
# Logs inline no CMD para Railway capturar
# ===========================================

# Stage 1: Build
FROM node:20-alpine AS builder

RUN apk add --no-cache python3 make g++ openssl bash

WORKDIR /app

COPY . .

RUN echo "=== Files copied ===" && ls -la

RUN echo "=== Installing dependencies ===" && \
    npm install --no-audit --no-fund --legacy-peer-deps && \
    echo "=== Dependencies installed ==="

RUN echo "=== Generating Prisma ===" && \
    npx prisma generate 2>&1 && \
    echo "=== Prisma generated ==="

RUN echo "=== Building TypeScript ===" && \
    npx tsc 2>&1 && \
    echo "=== TypeScript built ===" && \
    ls -la dist/ && \
    echo "=== Build complete ==="

# ===========================================
# Stage 2: Production
# ===========================================

FROM node:20-alpine AS production

RUN apk add --no-cache openssl dumb-init wget curl bash

RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

WORKDIR /app

COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nodejs:nodejs /app/prisma.config.ts ./
COPY --from=builder --chown=nodejs:nodejs /app/package*.json ./

RUN npm prune --omit=dev 2>&1 || echo "Prune warning - continuing"

USER nodejs

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-3001}/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["bash", "-c", "echo '=== DJEN MONITOR STARTING ===' && echo 'PORT=$PORT' && echo 'NODE_ENV=$NODE_ENV' && echo 'DATABASE_URL set: '$(test -n \"$DATABASE_URL\" && echo yes || echo no) && echo 'PWD='$(pwd) && echo 'User='$(whoami) && echo 'Files:' && ls -la && echo 'Dist files:' && ls -la dist/ && echo '=== EXECUTING NODE ===' && exec node dist/server.js"]
