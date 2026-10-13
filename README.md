# potato-mana

Self-hosted Magic: The Gathering collection and deck manager (ManaBox-class), for the home lab.
Spec: [docs/BRIEF.md](docs/BRIEF.md). Decisions: [docs/DECISIONS.md](docs/DECISIONS.md). Status: **M2 collection** (M0 scaffold, M1 catalog and search done).

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
| `RESTORE_POINT_KEEP` | `30` | restore points kept per user |
| `INGEST_CRON` | `0 4 * * *` | Scryfall bulk refresh (also runs once on first start, and from the Jobs page) |
| `SCRYFALL_USER_AGENT` | `potato-mana/0.1 (self-hosted personal instance)` | sent to Scryfall; keep it descriptive |
| `BACKUP_CRON` | `30 2 * * *` | nightly backup schedule |
| `BACKUP_KEEP_DAYS` | `14` | backup retention |
| `NTFY_URL`, `NTFY_TOPIC`, `NTFY_TOKEN` | empty | job failure notifications (token optional) |
| `WEB_DIR` | auto | built frontend directory |

App name is the single constant `APP_NAME` in `packages/shared/src/index.ts`.

## Card data and search

Data comes from Scryfall bulk files (`default_cards`, `rulings`, plus `/sets` and `/symbology`), downloaded when `updated_at` changed, streamed as JSONL.gz into SQLite (about 20 s for 118k printings). Ingest is idempotent; printings that disappear are flagged `superseded`, never deleted, so collection rows keep working. Images and mana symbols are fetched from `*.scryfall.io` on first use and served unmodified from `/data/img`. Prices are Scryfall estimates and are shown with the bulk file date.

Search box syntax (subset of Scryfall's): `c:rg` (includes), `c=rg`, `c<=rg`, `id<=wubg`, `t:elf`, `o:"draw a card"` (`~` is the card's name), `kw:flying`, `mv>=3`, `pow>3`, `r:rare`, `s:mh2`, `f:commander`, `usd>5`, `eur<1`, `a:"name"`, `lang:`, `year>=2020`, `is:foil|nonfoil|etched|reprint|promo|fullart|dfc|split|transform|mdfc|gamechanger|token`, `-negation`, `or`, `( )`, `!"Exact Name"`. Unknown keywords return an error instead of being ignored. Digital-only cards and tokens/extras are hidden unless asked for.

## Collection

- **Binders** (cards you own) and **lists** (cards you track). A stack is one printing with one set of properties (finish, language, condition, purchase price, misprint, altered, notes, tags); identical stacks merge, different properties stay separate.
- Bulk edit, delete and **partial move** (N copies) work on any selection; "add complete set" fills a container from a set code.
- **Collector mode** (`/collector`): group by set, type, color, rarity (nested, in the order you pick them), see owned vs missing, sort groups by total, collected or completion %. It honours the search syntax, "group printings" and a filter for cards you own in no version.
- **Value**: estimated from Scryfall prices per finish (EUR by default). Purchase price falls back to the market price on the day the stack was added; purchases in another currency are left out of the change figure rather than guessed.
- **Restore points**: taken automatically before bulk edits, deletes, moves, set adds, imports and rollbacks (per user, last `RESTORE_POINT_KEEP`). A rollback restores containers and stacks and is itself undoable.
- **CSV import**: `POST /api/v1/import/csv` (or the Import page). Headers are matched tolerantly (ManaBox, Moxfield, Archidekt, Deckbox, TCGplayer, Cardmarket style); minimum is a Scryfall ID, or name plus set code/name. A `Binder Name` column creates the containers. Valid rows are imported, failures are reported with line numbers and returned as a downloadable CSV with an `error` column. Export is the ManaBox-like column set plus notes, tags and date.
- Search keywords for owned cards: `is:owned`, `in:"Binder name"`.

### Add an importer

Importers are header alias maps in `apps/server/src/csv.ts` (`ALIASES`) feeding `importCsv` in `import.ts`. To support a new CSV flavour add its header names to `ALIASES` (value normalisers `normFinish`, `normCondition`, `normLang` handle the usual spellings) and add a fixture row to `apps/server/test/collection.test.ts`. A different file format (not CSV) would produce the same row objects and call `addEntry`.

## Backup and restore

Nightly `backup` job (visible and runnable from the admin Jobs page) writes a consistent copy with the SQLite backup API to `/data/backups/potato-mana-<stamp>.sqlite` and prunes files older than `BACKUP_KEEP_DAYS`.

Restore: stop the container, copy the chosen file over `/data/app.sqlite`, delete `app.sqlite-wal` and `app.sqlite-shm`, start the container. `./data` is covered by the homelab restic job once it is under `/opt/services/`.

