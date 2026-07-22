# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS build
WORKDIR /src
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json .prettierrc.json ./
RUN apt-get update && apt-get install -y --no-install-recommends build-essential linux-libc-dev \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable
RUN --mount=type=cache,id=pi-haos-npm-cache,target=/root/.npm \
  npm install --prefix /src/pi --ignore-scripts --omit=dev \
    @earendil-works/pi-coding-agent@0.81.1 \
  && test "$(/src/pi/node_modules/.bin/pi --version)" = "0.81.1"
COPY packages ./packages
RUN --mount=type=cache,id=pi-haos-pnpm-store,target=/root/.local/share/pnpm/store \
  pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm deploy --legacy --filter @pi-ha/backend --prod /out
RUN gcc -O2 -Wall -Wextra -o /src/pi-sandbox packages/pi-runtime/src/pi-sandbox.c

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=8099 HOST=0.0.0.0 FRONTEND_DIST=/app/frontend/dist \
  PI_VERSION=0.81.1 PI_COMMAND=/opt/pi/node_modules/.bin/pi
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends util-linux \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 10001 --create-home --shell /usr/sbin/nologin pi-agent \
  && mkdir -p /data /homeassistant \
  && chown pi-agent:pi-agent /data
COPY --from=build /out ./backend
COPY --from=build /src/packages/frontend/dist ./frontend/dist
COPY --from=build /src/pi-sandbox ./bin/pi-sandbox
COPY --from=build /src/pi /opt/pi
COPY app/pi-runtime.json /app/pi-runtime.json
COPY app/pi-tools /app/pi-tools
COPY skills/bundled /app/bundled-skills
COPY app/rootfs/entrypoint.sh /entrypoint.sh
COPY app/apparmor.txt /app/apparmor.txt
RUN chmod 0755 /entrypoint.sh
EXPOSE 8099
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node /app/backend/dist/server.js
ENTRYPOINT ["/entrypoint.sh"]
