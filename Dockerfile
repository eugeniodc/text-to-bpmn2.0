# Multi-stage build for Text-to-BPMN 2.0
FROM node:20-slim AS builder

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install all dependencies including build tools
RUN npm install

# Copy source code and configuration
COPY . .

# Build client bundle
RUN npm run build

# Production runtime image
FROM node:20-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV DOCKER_CONTAINER=true

# Install D2 compiler (and curl/ca-certificates)
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && \
    curl -fsSL https://d2lang.com/install.sh | sh -s -- && \
    apt-get purge -y --auto-remove curl && \
    rm -rf /var/lib/apt/lists/*

# Copy package manifests and install only production dependencies
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copy built app and assets from builder stage
COPY --from=builder --chown=node:node /app/server.js ./server.js
COPY --from=builder --chown=node:node /app/system_prompt.txt ./system_prompt.txt
COPY --from=builder --chown=node:node /app/system_prompt_camunda.txt ./system_prompt_camunda.txt
COPY --from=builder --chown=node:node /app/scripts ./scripts
COPY --from=builder --chown=node:node /app/public ./public

# Use non-root node user
USER node

# Expose HTTP port
EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/api/active-model').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Start the application
CMD ["node", "server.js"]
