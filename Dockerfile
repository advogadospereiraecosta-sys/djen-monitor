# ===========================================
# DJEN Monitor - Dockerfile Simplificado v2
# Para Railway - mais resiliente
# ===========================================

# Stage 1: Build
FROM node:20-alpine AS builder

RUN apk add --no-cache python3 make g++ openssl

WORKDIR /app

# Copiar tudo primeiro
COPY . .

# Instalar dependencias (gera lockfile se não existir)
RUN npm install --no-audit --no-fund --legacy-peer-deps || npm install --no-audit --no-fund

# Build
RUN npm run build 2>&1 || (echo "=== Build falhou, tentando novamente ===" && sleep 10 && npm run build)

# ===========================================
# Stage 2: Production
# ===========================================
FROM node:20-alpine AS production

RUN apk add --no-cache openssl dumb-init wget

RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

WORKDIR /app

# Copiar tudo do builder
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nodejs:nodejs /app/prisma.config.ts ./
COPY --from=builder --chown=nodejs:nodejs /app/package*.json ./

# Tentar prune (mas não falhar se der erro)
RUN npm prune --omit=dev 2>&1 || echo "Prune falhou mas continuando"

USER nodejs

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-3001}/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]