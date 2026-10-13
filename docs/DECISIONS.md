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

### Scryfall (fetched 2026-10-13 from scryfall.com/docs and api.scryfall.com)

- Docs pages return 403 to the WebFetch tool; plain `curl` with a descriptive `User-Agent` works.
- **Bulk files are gzipped JSONL, not a JSON array** (`jsonl.gz`, one card per line). `GET /bulk-data` objects expose `type`, `updated_at`, `jsonl_download_uri`, `compressed_size` (no `download_uri`/`size`). Types present: `oracle_cards`, `unique_artwork`, `default_cards` (~79 MB gz, ~118k cards), `all_cards` (~396 MB gz), `rulings`, `art_tags`, `oracle_tags`.
- Files are regenerated every 12-24 h; prices are stale after 24 h; gameplay data changes rarely.
- Required on every `api.scryfall.com` request: accurate `User-Agent` (app name/version, not the HTTP library default) and an `Accept` header (`*/*` is fine).
- Rate limits: `/cards/search|named|random|collection` 2/s; `/cards/manifest` 10/min; everything else 10/s. `*.scryfall.io` has none. A 429 limits access for 30 s; ignoring it risks a ban.
- Cache locally at least 24 h. Card object has `game_changer` (nullable bool), `finishes`, `prices` (usd/eur/tix keys), `card_faces`, `illustration_id`, `tcgplayer_id`, `cardmarket_id`, `mtgo_id`, `purchase_uris`.
- Search syntax semantics checked with live counts: `c:wu` == `c>=wu` (720), `id:wu` == `id<=wu` (13457, commander "within" semantics), `id=wu` exact (512).

### Measured on the real file (2026-10-13, 118,654 printings, 38,751 Oracle IDs)
- Ingest 19-23 s, 220 MB RSS, DB 258 MB. First start in the container (download + ingest) about 30 s.
- Search latency, in-process, typical queries 3-90 ms; worst cases 170-270 ms (10k+ result sets such as `id:wu`, `f:commander id<=wubg o:draw`). Needed: `ANALYZE` after ingest, forced join order, a precomputed `latest` printing per Oracle, a finish bitmask, and capping totals at 10,000 ("10000+") because exact counts of huge results cost more than the page itself.
- Scryfall `rulings`: 79,706 rows for 20,080 Oracle IDs (Lightning Bolt has none).

### Implementation choices from this
- `oracle_cards` bulk is **not** downloaded: oracle rows are derived from `default_cards` (same gameplay data on every printing), saving a 24 MB download and a second source of truth.
- `all_cards` / Italian printed names: answer was "no"; not implemented. Add as opt-in later.
- Group-printings picks the newest matching printing, which can be one without prices (e.g. a The List reprint); a smarter representative (prefer one with a price) is a later refinement.
- Autocomplete is FTS5 prefix only; typo-tolerant fuzzy matching deferred.
- `o:` searches text including reminder text (Scryfall excludes it); `fo:` is an alias.
- Ingest is idempotent rather than byte-resumable: re-running re-downloads and re-upserts.
