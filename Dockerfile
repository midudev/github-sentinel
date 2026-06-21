FROM oven/bun:1 AS base
WORKDIR /usr/src/app

FROM base AS install
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile --production

FROM base AS release
COPY --from=install /usr/src/app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production
ENV SENTINEL_DB_PATH=data/sentinel.db

RUN mkdir -p /usr/src/app/data

EXPOSE 3741
CMD ["bun", "src/server/index.ts"]
