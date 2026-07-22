FROM node:24-bookworm-slim AS build
WORKDIR /src
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json .prettierrc.json ./
COPY packages ./packages
RUN apt-get update && apt-get install -y --no-install-recommends build-essential linux-libc-dev \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable && pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm deploy --legacy --filter @pi-ha/backend --prod /out
RUN gcc -O2 -Wall -Wextra -o /src/pi-sandbox packages/pi-runtime/src/pi-sandbox.c

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=8099 HOST=0.0.0.0 FRONTEND_DIST=/app/frontend/dist
WORKDIR /app
RUN useradd --system --uid 10001 --create-home --shell /usr/sbin/nologin pi-agent \
  && mkdir -p /data /homeassistant \
  && chown pi-agent:pi-agent /data
COPY --from=build /out ./backend
COPY --from=build /src/packages/frontend/dist ./frontend/dist
COPY --from=build /src/pi-sandbox ./bin/pi-sandbox
COPY app/rootfs/entrypoint.sh /entrypoint.sh
COPY app/apparmor.txt /app/apparmor.txt
RUN chmod 0755 /entrypoint.sh
USER pi-agent
EXPOSE 8099
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node /app/backend/dist/server.js
ENTRYPOINT ["/entrypoint.sh"]
