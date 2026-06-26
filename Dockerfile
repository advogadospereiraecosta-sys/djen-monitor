# ===========================================
# DJEN Monitor - Dockerfile Verbose
# Para Railway - logs detalhados em cada etapa
# ===========================================

# Stage 1: Build
FROM node:20-alpine AS builder

RUN apk add --no-cache python3 make g++ openssl

WORKDIR /app

# Copia tudo
COPY . .

# Log do que está acontecendo
RUN echo "=== Files copied ===" && ls -la

# Instala dependências
RUN echo "=== Installing dependencies ===" && \
    npm install --no-audit --no-fund --legacy-peer-deps && \
    echo "=== Dependencies installed ==="

# Build TypeScript
RUN echo "=== Building TypeScript ===" && \
    npx prisma generate 2>&1 && \
    echo "=== Prisma generated ===" && \
    npx tsc 2>&1 && \
    echo "=== TypeScript built ===" && \
    ls -la dist/ && \
    echo "=== Build complete ==="

# ===========================================
# Stage 2: Production
# ===========================================

FROM node:20-alpine AS production

RUN apk add --no-cache openssl dumb-init wget curl

RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

WORKDIR /app

# Copia artefatos do builder
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nodejs:nodejs /app/prisma.config.ts ./
COPY --from=builder --chown=nodejs:nodejs /app/package*.json ./

# Verifica que os arquivos foram copiados
RUN echo "=== Verifying dist contents ===" && \
    ls -la dist/ && \
    echo "=== Verifying server.js exists ===" && \
    test -f dist/server.js && echo "dist/server.js OK" || (echo "dist/server.js MISSING!" && exit 1)

# Prune
RUN npm prune --omit=dev 2>&1 || echo "Prune warning - continuing"

USER nodejs

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-3001}/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "echo '=== Starting DJEN Monitor ===' && node dist/server.js"]
