# Decisions

## 2026-10-13 - M0

- **Name:** repo and `APP_NAME` are `potato-mana` (brief working name was Cardvault). One constant in `packages/shared`.
- **Hostname:** `mana-potato.home.potato` (user choice), configurable via `APP_HOST`.
- **Deployment:** brief assumes Komodo; the homelab uses Dockhand + deploy webhook + Forgejo registry. `compose.yaml` is plain Compose and works with either. Image name `forgejo.home.potato/ciccio/potato-mana`.
- **Auth:** Authelia forward-auth (headers) as chosen, local accounts kept for first run, dev and fallback. Homelab apps with their own login normally use OIDC; header mode was taken because the brief specifies it and avoids a client registration. Trade-off: Authelia's 5 min inactivity timeout applies. Switch to OIDC if that annoys.
- **No OpenAPI yet:** `/api/docs` and Zod-to-OpenAPI generation deferred until there are enough routes to justify it (M1).
- **No service worker yet:** PWA manifest/offline shell deferred to M1 with the first real data views.
- **No Playwright yet:** first e2e flow is CSV import (M2). Server integration tests use `fastify.inject`.
- **Restore drill in CI:** deferred to M9 as in the brief; backup + manual restore procedure exists now.
- **Tooling:** Biome for lint/format (one dependency instead of eslint + prettier). tsup bundles the server; native modules (`better-sqlite3`, `argon2`) stay external.
- **pnpm 12:** native build scripts need `allowBuilds` in `pnpm-workspace.yaml` (the old `onlyBuiltDependencies` key is ignored).

## External API facts verified

None yet. Scryfall/MTGJSON docs are fetched and recorded here at the start of M1.
