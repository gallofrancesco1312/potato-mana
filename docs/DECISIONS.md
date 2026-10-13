# Decisions

## 2026-10-13 - M0

- **Name:** repo and `APP_NAME` are `potato-mana` (brief working name was Cardvault). One constant in `packages/shared`.
- **Hostname:** `mana-potato.home.potato` (user choice), configurable via `APP_HOST`.
- **Deployment:** brief assumes Komodo; the homelab uses Dockhand + deploy webhook + Forgejo registry. `compose.yaml` is plain Compose and works with either. Image name `forgejo.home.potato/ciccio/potato-mana`.
- **Auth:** Authelia OIDC (user choice, same pattern as cooktrace/potato-split), authorization code + PKCE via `openid-client`, claims from the userinfo endpoint. Local accounts kept for first run and fallback. The forward-auth header mode from the brief was implemented first and removed: it would add Authelia's 5 min inactivity timeout to the PWA and the header trust needs careful router config. Re-add only if wanted.
- **No OpenAPI yet:** `/api/docs` and Zod-to-OpenAPI generation deferred until there are enough routes to justify it (M1).
- **No service worker yet:** PWA manifest/offline shell deferred to M1 with the first real data views.
- **No Playwright yet:** first e2e flow is CSV import (M2). Server integration tests use `fastify.inject`.
- **Restore drill in CI:** deferred to M9 as in the brief; backup + manual restore procedure exists now.
- **Tooling:** Biome for lint/format (one dependency instead of eslint + prettier). tsup bundles the server; native modules (`better-sqlite3`, `argon2`) stay external.
- **pnpm 12:** native build scripts need `allowBuilds` in `pnpm-workspace.yaml` (the old `onlyBuiltDependencies` key is ignored).

## External API facts verified

None yet. Scryfall/MTGJSON docs are fetched and recorded here at the start of M1.
