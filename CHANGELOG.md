# Changelog

## Unreleased

### M3 - prices and alerts
- Sparse daily price history for tracked cards, first point on view/add; collection value history per container; best and worst movers.
- Per-user reference currency; "prices as of" on search, collection, container, watchlist, card and settings pages.
- Watchlist, price alerts (above, below, percent rise/drop; edge-triggered), notification inbox with unread badge, ntfy delivery with optional personal topic.
- Accessible line chart (step lines, crosshair tooltip, keyboard, table view, light/dark tokens).

### M2 - collection
- Binders and lists with nesting, stacks with all properties, bulk edit, delete, partial move, add whole set.
- Collector mode with nested grouping, group printings and reprint filter; search keywords `is:owned`, `in:`.
- Value and purchase tracking per container and overall.
- CSV import (tolerant headers, failure report with line numbers, failed-rows CSV) and export.
- Restore points before bulk operations and imports, undoable rollback, per-user isolation tests.
- Web: collection, container, collector, import, restore pages; add-to-collection on the card page.

### M1 - card database and search
- Scryfall bulk ingest (JSONL.gz): printings, derived Oracle rows, rulings, sets, symbols; FTS5 name search; `scryfall-ingest` job (nightly + first start).
- Search API with Scryfall-style syntax, grouping, sorting, paging; autocomplete; card detail with rulings, legalities, printings, prices and price date.
- Local image and symbol cache; web UI: search with visual filters, results grid, card page with face flip.

### M0 - scaffold
- pnpm workspace: `apps/server` (Fastify), `apps/web` (React/Vite/Tailwind), `packages/shared`.
- SQLite + Drizzle migrations applied at startup; `/healthz`; JSON logs; graceful shutdown.
- Auth: local accounts (argon2id, session cookie, first-run setup, admin creates users) and Authelia OIDC login (code + PKCE, group to admin role).
- Origin check on mutations, login/setup rate limit, CSP and security headers.
- Jobs: in-process scheduler (croner) with `jobs` table, nightly SQLite backup + retention, ntfy on failure, admin Jobs page.
- i18n skeleton (it default, en), light/dark theme, required footer disclaimer.
- Dockerfile (non-root, read-only rootfs friendly, healthcheck), `compose.yaml` (Traefik labels), `compose.dev.yaml`, CI.
