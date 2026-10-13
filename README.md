# potato-mana

Self-hosted Magic: The Gathering collection and deck manager (ManaBox-class), for the home lab.
Spec: [docs/BRIEF.md](docs/BRIEF.md). Decisions: [docs/DECISIONS.md](docs/DECISIONS.md). Status: **M0 scaffold**.

Stack: Node 22, Fastify, SQLite (WAL) + Drizzle, React + Vite + Tailwind, TanStack Query/Router. One image, one `/data` volume.

## Run

```sh
# smoke test, plain http://localhost:3000, local accounts
docker compose -f compose.dev.yaml up --build

# dev loop (server :3000 with reload, web :5173 proxying /api)
pnpm install
pnpm dev
```

First visit creates the admin account. More users: `POST /api/v1/admin/users` (admin) or they are created on first Authelia login.

Checks: `pnpm lint && pnpm typecheck && pnpm test`.

## Production (Traefik + Authelia OIDC)

`compose.yaml` expects the external `proxy` network. The router has no `authelia@docker` middleware: login is OIDC and the app keeps its own 30 day session.

1. Register the client in `authelia/configuration.yml` (`identity_providers.oidc.clients`), hash the secret with `authelia crypto hash generate pbkdf2`:
   ```yaml
   - client_id: 'mana-potato'
     client_name: 'potato-mana'
     client_secret: '<pbkdf2 hash>'
     public: false
     authorization_policy: 'one_factor'
     redirect_uris: ['https://mana-potato.home.potato/api/v1/auth/oidc/callback']
     scopes: ['openid', 'profile', 'email', 'groups']
     userinfo_signed_response_alg: 'none'
     token_endpoint_auth_method: 'client_secret_basic'
   ```
2. Copy `.env.example` to `.env`, set the plaintext `OIDC_CLIENT_SECRET`, then `docker compose up -d`.
3. DNS: add `mana-potato.home.potato` to Pi-hole `dns.hosts`.

Any Authelia user who logs in gets an account (Authelia is the gatekeeper); members of `ADMIN_GROUP` are admins, re-synced on every SSO login. A local account with the same username is adopted on first SSO login. Local accounts stay available for first run and as fallback.

Camera access needs HTTPS: the wildcard `*.home.potato` cert is fine once the phone trusts the local CA.

## Environment

| Var | Default | Meaning |
|-----|---------|---------|
| `PORT` | `3000` | listen port |
| `DATA_DIR` | `./data` (`/data` in image) | SQLite file, backups, later image cache |
| `COOKIE_SECURE` | `true` | `Secure` flag on session cookie (set `false` only for plain-http dev) |
| `SESSION_DAYS` | `30` | session lifetime |
| `PUBLIC_URL` | `http://localhost:3000` | external origin, builds the OIDC redirect URI |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | empty | enable SSO login when all set |
| `ADMIN_GROUP` | `admins` | OIDC group mapped to admin |
| `BACKUP_CRON` | `30 2 * * *` | nightly backup schedule |
| `BACKUP_KEEP_DAYS` | `14` | backup retention |
| `NTFY_URL`, `NTFY_TOPIC`, `NTFY_TOKEN` | empty | job failure notifications (token optional) |
| `WEB_DIR` | auto | built frontend directory |

App name is the single constant `APP_NAME` in `packages/shared/src/index.ts`.

## Backup and restore

Nightly `backup` job (visible and runnable from the admin Jobs page) writes a consistent copy with the SQLite backup API to `/data/backups/potato-mana-<stamp>.sqlite` and prunes files older than `BACKUP_KEEP_DAYS`.

Restore: stop the container, copy the chosen file over `/data/app.sqlite`, delete `app.sqlite-wal` and `app.sqlite-shm`, start the container. `./data` is covered by the homelab restic job once it is under `/opt/services/`.

## Add an importer

Importers arrive with M2 (collection CSV). This section is filled then.
