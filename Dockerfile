# Foreman engine — the ONE server (HTTP API on $PORT + internal crew server on $PORT+1).
# Runs the gateway rail (real USDC settlement on Arc via Circle Gateway).
# tsx runs the TypeScript directly — no build step.
FROM node:20-slim

WORKDIR /app

# Install deps first (layer-cached). Includes tsx, which the engine runs on.
COPY package.json package-lock.json ./
RUN npm ci

# App source (web/ is excluded via .dockerignore — the engine is standalone).
COPY tsconfig.json ./
COPY src ./src

# Persisted state (accounts, credit scores, crew reputation, ledger). Mount a
# Railway volume here so it survives redeploys: Volume → mount path /app/data.
RUN mkdir -p /app/data
ENV NODE_ENV=production
ENV ENGINE_RAIL=gateway

# Railway injects PORT. The engine binds PORT (public API) and PORT+1 (internal crew).
EXPOSE 8799
CMD ["npx", "tsx", "src/server.ts"]
