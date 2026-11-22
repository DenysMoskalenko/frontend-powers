# syntax=docker/dockerfile:1

FROM node:26.13.1-trixie-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS build
# Node 25+ ships no corepack: install the pnpm that package.json's devEngines pins.
RUN npm install --global pnpm@12.22.0
WORKDIR /app
# Lockfile only: this layer survives every source edit.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm fetch --store-dir /pnpm/store
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --store-dir /pnpm/store
# One image per environment: the origins are baked into the bundle and the CSP.
ARG PUBLIC_API_ORIGIN
RUN pnpm build \
    && mv dist/headers.caddy /headers.caddy \
    && rm dist/_headers dist/.assetsignore \
    && find dist -name '*.map' -delete

FROM caddy:2.11.9-alpine@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0 AS caddy

FROM scratch
COPY --from=caddy /usr/bin/caddy /caddy
# Go's built-in MIME table lacks woff2 and webmanifest.
COPY --from=caddy /etc/mime.types /etc/mime.types
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /headers.caddy /etc/caddy/headers.caddy
COPY --from=build /app/dist /public
# Numeric: Kubernetes runAsNonRoot cannot verify a named user, and scratch has no passwd.
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
