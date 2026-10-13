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

First visit creates the admin account. More users: `POST /api/v1/admin/users` (admin) or, with forward-auth, they are created on first Authelia login.

Checks: `pnpm lint && pnpm typecheck && pnpm test`.

## Production (Traefik + Authelia)

`compose.yaml` expects the external `proxy` network and the `authelia@docker` middleware. Copy `.env.example` to `.env`, set `TRUSTED_PROXIES` to the Traefik address/CIDR on `proxy` (`docker network inspect proxy`), then `docker compose up -d`.

Forward-auth mode (`FORWARD_AUTH=true`): the app trusts `Remote-User`, `Remote-Email`, `Remote-Groups` only when the TCP peer is in `TRUSTED_PROXIES`. The router **must** carry the Authelia middleware, otherwise a client can set those headers through Traefik. Members of `ADMIN_GROUP` are admins; role is re-synced from Authelia on each request.

Camera access needs HTTPS: the homelab wildcard `*.home.potato` cert is fine once the phone trusts the local CA.

## Environment

| Var | Default | Meaning |
|-----|---------|---------|
| `PORT` | `3000` | listen port |
| `DATA_DIR` | `./data` (`/data` in image) | SQLite file, backups, later image cache |
| `COOKIE_SECURE` | `true` | `Secure` flag on session cookie (set `false` only for plain-http dev) |
| `SESSION_DAYS` | `30` | session lifetime |
| `FORWARD_AUTH` | `false` | enable Authelia header auth |
| `TRUSTED_PROXIES` | empty | comma list of IPs/CIDRs allowed to send forward-auth headers |
| `ADMIN_GROUP` | `admins` | Authelia group mapped to admin |
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
