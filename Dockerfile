FROM caddy:2.10.2 AS caddy

FROM node:22-bookworm-slim AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@10.32.1
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN base64 -d deployment.tar.gz.b64 > /tmp/deployment.tar.gz \
  && tar -xzf /tmp/deployment.tar.gz -C /app \
  && rm -f /tmp/deployment.tar.gz deployment.tar.gz.b64
RUN pnpm build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV DATABASE_PATH=/data/design-weekly.sqlite
ENV MEDIA_ROOT=/data/uploads
ENV COLLABORATION_PORT=1234
ENV COLLAB_INTERNAL_URL=http://127.0.0.1:1234/internal/restore
ENV APP_TIMEZONE=Asia/Shanghai
RUN apt-get update \
  && apt-get install -y --no-install-recommends procps \
  && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@10.32.1
WORKDIR /app
COPY --from=caddy /usr/bin/caddy /usr/bin/caddy
COPY --chown=node:node --from=build /app /app
RUN mkdir -p /data/uploads
EXPOSE 8080 3000 1234
CMD ["node", "server/railway-entrypoint.mjs"]
