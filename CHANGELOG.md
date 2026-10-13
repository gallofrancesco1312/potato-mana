# Changelog

## Unreleased

### M0 - scaffold
- pnpm workspace: `apps/server` (Fastify), `apps/web` (React/Vite/Tailwind), `packages/shared`.
- SQLite + Drizzle migrations applied at startup; `/healthz`; JSON logs; graceful shutdown.
- Auth: local accounts (argon2id, session cookie, first-run setup, admin creates users) and Authelia OIDC login (code + PKCE, group to admin role).
- Origin check on mutations, login/setup rate limit, CSP and security headers.
- Jobs: in-process scheduler (croner) with `jobs` table, nightly SQLite backup + retention, ntfy on failure, admin Jobs page.
- i18n skeleton (it default, en), light/dark theme, required footer disclaimer.
- Dockerfile (non-root, read-only rootfs friendly, healthcheck), `compose.yaml` (Traefik labels), `compose.dev.yaml`, CI.
