# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df

FROM ${NODE_IMAGE} AS build-tools

RUN apt-get update \
    && apt-get install --yes --no-install-recommends g++ make python3 \
    && rm -rf /var/lib/apt/lists/*

FROM build-tools AS dependencies

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH} \
    CI=true

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.22.0 --activate

# 先复制依赖清单，使源码变化不会使依赖层失效。
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/client/package.json ./packages/client/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/frontend-core/package.json ./packages/frontend-core/package.json
COPY packages/protocol/package.json ./packages/protocol/package.json
COPY packages/provider-codex/package.json ./packages/provider-codex/package.json
COPY packages/server/package.json ./packages/server/package.json
COPY packages/ui/package.json ./packages/ui/package.json
COPY desktop/package.json ./desktop/package.json
COPY desktop/patches/@wdio__tauri-service@1.3.0.patch ./desktop/patches/@wdio__tauri-service@1.3.0.patch
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter '!codeagent' install --frozen-lockfile

FROM dependencies AS build

COPY . .
RUN pnpm run build:clean

FROM dependencies AS production-dependencies

# 服务端已打包，运行时只需要 Codex 和 SQLite；不复制工作区前端依赖及 pnpm 构建存储。
# npm 稳定安装当前平台 Codex 包，两个直接依赖的版本均读取已冻结安装的清单。
RUN CODEX_VERSION="$(node -p "require('./node_modules/@openai/codex/package.json').version")" \
    && SQLITE_VERSION="$(node -p "require('./node_modules/better-sqlite3/package.json').version")" \
    && npm install --prefix /opt/codexly --omit=dev --ignore-scripts \
      "@openai/codex@${CODEX_VERSION}" "better-sqlite3@${SQLITE_VERSION}" \
    && /opt/codexly/node_modules/.bin/codex --version \
    && node -e 'const Database = require("/opt/codexly/node_modules/better-sqlite3"); const db = new Database(":memory:"); db.prepare("SELECT 1").get(); db.close();' \
    && npm cache clean --force

FROM ${NODE_IMAGE} AS runtime

ARG VERSION=dev
ARG REVISION=unknown

LABEL org.opencontainers.image.title="Codexly" \
      org.opencontainers.image.description="Operate Codex from a Web interface" \
      org.opencontainers.image.source="https://github.com/BryanHoo/Codexly" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates git openssh-client tini \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /home/node/.codex /workspace \
    && chown -R node:node /home/node/.codex /workspace

ENV NODE_ENV=production \
    PATH=/opt/codexly/node_modules/.bin:${PATH} \
    CODEX_HOME=/home/node/.codex \
    CODEXLY_PORT=3210 \
    CODEXLY_STARTUP_UPDATE_APPLIED=1

# 只复制独立生产安装，避免携带前端依赖、构建存储和另一份 Codex。
COPY --from=build --chown=node:node /app/package.json /opt/codexly/package.json
COPY --from=build --chown=node:node /app/dist /opt/codexly/dist
COPY --from=production-dependencies --chown=node:node \
    /opt/codexly/node_modules /opt/codexly/node_modules

WORKDIR /workspace
USER node

EXPOSE 3210

HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.CODEXLY_PORT ?? '3210'}/v1/health`).then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]

ENTRYPOINT ["/usr/bin/tini", "--", "node", "/opt/codexly/dist/cli.js"]
CMD ["start", "--lan"]
