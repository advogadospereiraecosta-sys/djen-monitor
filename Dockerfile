# ===========================================
# DJEN Monitor - Dockerfile Multi-stage
# Otimizado para Railway
# ===========================================

# Stage 1: Build
FROM node:20-alpine AS builder

# Install build dependencies (python3, make, g++ for native modules)
RUN apk add --no-cache python3 make g++ openssl

WORKDIR /app

# Copy package files (with lockfile for reproducible builds)
COPY package*.json ./

# Install ALL dependencies (including dev for build)
RUN npm ci --include=dev

# Copy prisma schema and config
COPY prisma ./prisma
COPY prisma.config.ts ./

# Generate Prisma client
RUN npx prisma generate

# Copy TypeScript config
COPY tsconfig.json ./

# Copy source code
COPY src ./src

# Build TypeScript
RUN npm run build

# ===========================================
# Stage 2: Production
# ===========================================
FROM node:20-alpine AS production

# Install runtime dependencies
RUN apk add --no-cache openssl dumb-init wget

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Copy package files
COPY --from=builder --chown=nodejs:nodejs /app/package*.json ./

# Copy node_modules with production deps only
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules

# Remove dev dependencies to reduce image size
RUN npm prune --omit=dev

# Copy built files
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist

# Copy Prisma schema (needed at runtime for migrations)
COPY --from=builder --chown=nodejs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nodejs:nodejs /app/prisma.config.ts ./

# Set ownership
USER nodejs

# Expose port (Railway uses PORT env var, default 3001)
EXPOSE 3001

# Health check - Railway injeta PORT automaticamente
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-3001}/health || exit 1

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Default command - runs server
CMD ["node", "dist/server.js"]