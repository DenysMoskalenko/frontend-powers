# frontend-app

A React single-page app for the users API in `openapi.json`.

## Run

Needs pnpm 12 (`npm install --global pnpm@12.22.0`); pnpm installs the Node version in `devEngines`.

```bash
pnpm install
pnpm dev            # http://localhost:5173, API at PUBLIC_API_ORIGIN from .env.development
```

The backend must allow `http://localhost:5173` in its CORS origins. Without a backend, run the
stub: `pnpm exec node e2e/stub-api.ts` (port 4010, the pinned Node) and
`PUBLIC_API_ORIGIN=http://127.0.0.1:4010 pnpm dev`.

## Check

```bash
pnpm check          # Biome, tsc, knip, Vitest
pnpm test:coverage  # Vitest with the 80 % line and branch thresholds
pnpm exec playwright install chromium  # once per machine: the browser for test:e2e
pnpm test:e2e       # Playwright against the production build and the stub API
pnpm hooks          # once per clone: install the pre-commit hooks
```

## Build and deploy

One build per environment: the API origin is baked into the bundle and the CSP.

```bash
PUBLIC_API_ORIGIN=https://api.example.com pnpm build
```

- Cloudflare: `pnpm exec wrangler deploy` serves `dist/` with the generated `dist/_headers`.
- Container: `docker build --build-arg PUBLIC_API_ORIGIN=https://api.example.com -t app .`, then
  `docker run --read-only --cap-drop ALL -p 8080:8080 app`.

The security and cache headers come from `deploy/headers.ts`; `vite preview` serves them too.

## API client

`openapi.json` is a copy of the backend's document. After updating it, run `pnpm format` (Biome
formats it like any other file) and `pnpm api:generate`, and commit it with `src/api/generated/`.
