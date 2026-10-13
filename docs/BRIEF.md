# Project brief: self-hosted MTG collection and deck manager (ManaBox-class)

Save this file in the new repository as `docs/BRIEF.md` and add a one-line pointer to it in `CLAUDE.md`. Working name: **Cardvault** (make the name a single config constant, I may rename it).

---

## 0. How to work on this project

1. **Start in plan mode.** Read this brief fully, then produce a plan: stack confirmation, repo layout, data model, milestone order. Do not write feature code before I approve the plan.
2. Ask me **only** the questions listed in section 11, in a single batch, and propose a default for each so I can answer "ok".
3. Work milestone by milestone (section 9). Each milestone ends with: tests green, `docker compose up` works from a clean checkout, a short `CHANGELOG.md` entry, and a demo script (curl calls or a Playwright run) that proves the acceptance criteria.
4. Commit small, with conventional commit messages. Keep `README.md` current (setup, env vars, backup/restore, how to add a new importer).
5. When a fact about an external API is uncertain, **fetch the official documentation** (links in section 12) instead of guessing, and write down in `docs/DECISIONS.md` what you verified and when.
6. If a requirement here conflicts with a data provider's terms, the terms win. Tell me and propose an alternative.

## 1. Goal and non-goals

**Goal.** A web app (installable PWA, phone-first, also good on desktop) running on my home server that does what the mobile app ManaBox does, including everything ManaBox puts behind its PRO subscription (cloud sync, unlimited binders, and any other gated feature). The server is the single source of truth, so there is no subscription, no device limit, and no binder limit.

**Non-goals.**
- No public hosting, no payments, no ads, no telemetry.
- No other card games. Magic: The Gathering only.
- No online play, no rules engine. The simulator is a goldfish tool (section 6.3).
- No scraping of retailer sites and no use of any ManaBox code, assets, name, logo or private API. Build from the public documentation of ManaBox's features and from your own design.

## 2. Hard constraints (data and legal)

These come from Scryfall's published rules and Wizards of the Coast's Fan Content Policy. Treat them as acceptance criteria.

- Data source for cards, sets, rulings, images and prices is **Scryfall**. Use the **bulk data files** for everything that touches many cards. Use the REST API (`api.scryfall.com`) only for single lookups, with 50 to 100 ms between requests, a descriptive `User-Agent` and an `Accept` header (check the current requirement in the docs). On HTTP 429, back off; never ignore it. The file origins on `*.scryfall.io` have no rate limit, but still download politely.
- Cache Scryfall data locally for at least 24 hours. Scryfall updates prices once per day, so fetching prices more often than every 24 hours is useless. Bulk files are regenerated about every 12 hours.
- **Do not repackage, republish or proxy Scryfall data.** The app must add value on top of it. Never expose a generic "card data" API that mirrors Scryfall to other people. The app is LAN-only anyway.
- Do not use Scryfall's name or logos in a way that implies endorsement. Add a footer: "Unofficial fan tool. Card data and images from Scryfall. Magic: The Gathering is property of Wizards of the Coast."
- **Card images:** never crop away the copyright line or artist name, never distort, stretch, blur, sharpen, desaturate or recolor, never add watermarks. If you show `art_crop`, show the artist name and copyright in the same view, or show the full card nearby.
- Prices are estimates. Label them as such and show the date of the last update.
- Do not scrape Cardmarket, TCGplayer, Card Kingdom or any other shop. Use only sources that publish bulk data or an API for this purpose (Scryfall, MTGJSON). If a provider needs credentials, make it an optional plugin disabled by default.

## 3. Deployment target (my homelab)

- Runs as a **Docker Compose** stack, deployed through **Komodo** (GitOps from a Git repo). Provide `compose.yaml` that Komodo can use as-is, plus a `compose.dev.yaml` for local development.
- Behind **Traefik** with a local domain (default `cards.home`, configurable). Provide the Traefik labels. Remember that the browser camera (`getUserMedia`) only works in a secure context, so the stack must work over HTTPS (my local CA or a self-signed cert). Document how to trust it on a phone.
- Authentication: built-in local accounts (argon2id) **and** an optional mode that trusts forward-auth headers from **Authelia** (`Remote-User`, `Remote-Email`, `Remote-Groups`) only when the request comes from a configured trusted proxy. Several users on one instance (me and my household), each with a private collection.
- Notifications through a self-hosted **ntfy** instance (URL and topic in env vars) for price alerts and job failures.
- One application image plus volumes: `/data` (SQLite file, image cache, hash index, backups). No other required services. Keep memory use modest (target under 512 MB at idle).
- Health endpoint (`/healthz`), structured JSON logs, graceful shutdown, non-root container, read-only root filesystem where possible, pinned image versions.
- Backups: nightly consistent SQLite backup (`VACUUM INTO` or the backup API) kept for N days (configurable), plus on-demand full JSON export and import of user data. Document the restore procedure and test it in CI.

## 4. Recommended stack (defaults, deviate only with a written reason)

- **Language:** TypeScript end to end, strict mode.
- **Backend:** Node 22 LTS, Fastify, Zod schemas shared with the frontend, OpenAPI generated from the schemas.
- **Database:** SQLite in WAL mode, with FTS5 for card search, Drizzle ORM with SQL migrations committed to the repo. Rationale: single-node, household scale, trivial backups.
- **Frontend:** React + Vite PWA, TanStack Query and Router, Tailwind. Mobile-first layouts, virtualized grids for large collections, dark and light themes, offline-tolerant (service worker caches the app shell and recently viewed data).
- **Jobs:** an in-process scheduler (for example `croner`) with a job table so runs are visible in an admin page: Scryfall ingest, price refresh, image/hash indexing, backups, alert evaluation.
- **Tests:** Vitest for unit and integration, Playwright for end-to-end, fixtures for every importer and exporter.
- **UI language:** Italian and English (i18n from day one, default Italian). Card names in the UI follow the chosen language when a printed name exists, otherwise English.

## 5. Data ingestion

1. **Scryfall bulk data.** On first start and then daily at night (and on demand from the admin page): read the `/bulk-data` listing, compare `updated_at` with the last ingest, download only if newer.
   - `default_cards` for printings (every card, in English or its only printed language).
   - `oracle_cards` for one record per Oracle ID (deck building, search by rules text).
   - `rulings`.
   - `unique_artwork` for the scanner index.
   - `all_cards` only if I enable the option "Italian printed names" (it is much larger; make it opt-in).
   - Also ingest sets, symbology (mana and set icons, cache locally) and the catalogs needed for filters.
2. Ingest by streaming JSON (do not load a multi-hundred-MB file in memory), in a transaction, with upserts keyed by Scryfall `id`. Keep ingest idempotent and resumable.
3. Fields to keep from the card object at minimum: ids (`id`, `oracle_id`, `illustration_id`, `tcgplayer_id`, `cardmarket_id`, `mtgo_id`), names, `lang`, set and `collector_number`, `released_at`, `layout`, faces (`card_faces`), mana cost, `cmc`, colors and color identity, type line, oracle text, power/toughness/loyalty, keywords, `legalities`, `finishes` (`nonfoil`, `foil`, `etched`), `frame_effects`, `promo_types`, `border_color`, `digital`, rarity, artist, `image_uris`, `prices` (`usd`, `usd_foil`, `usd_etched`, `eur`, `eur_foil`, `eur_etched`, `tix`), `purchase_uris`, `related_uris`, `produced_mana`, `game_changer`-style flags if present. Verify the exact field list against the current Scryfall card object docs.
4. **Prices.** Primary: Scryfall `prices` (USD from TCGplayer, EUR from Cardmarket, TIX), snapshotted daily. Optional second source: **MTGJSON** price files (it aggregates several providers, for example Card Kingdom, Cardmarket, TCGplayer). Verify license, file names and provider list before using it, and put every provider behind a `PriceProvider` interface so more can be added. Store daily snapshots **only for cards that are in some collection, list or deck** (plus a rolling window for the card detail chart), to keep the database small.
5. **Images.** Lazy-download and cache `normal` and `art_crop` from `*.scryfall.io` on first use. Provide a "pre-cache my collection" job. Serve from the local cache with correct cache headers.

## 6. Feature specification

Everything below is derived from ManaBox's public guides and store description. "Required" means required for parity.

### 6.1 Card search (required)

- Instant search over all cards and sets, including a fast name autocomplete (FTS5, prefix and fuzzy), working fully against the local database.
- Advanced filters: colors and color identity (exact, includes, at most), type, subtype, rarity, set and set type (including "reprint" filter), mana value, power/toughness, oracle text, keywords, artist, format legality, finish, language, price range, "owned / not owned", "in deck X", location (binder, list, deck). Offer a Scryfall-style query syntax as a power-user option and a visual filter builder for normal use.
- Group printings toggle (one entry per card name instead of per printing). Sort by name, set, release date, price, mana value, collector number.
- Option to hide digital-only cards (default hidden). Double-faced and split/adventure/meld layouts rendered correctly (flip button).
- Card detail view: large image, rulings, legalities per format, all printings, prices per provider and finish, price history chart, "where do I own this" (binders, lists, decks), links to buy and to Scryfall.

### 6.2 Collection (required)

- **Binders** (cards I own) and **Lists** (cards I only track: wishlist, buylist, ...). Binders are named after my physical binders so I can find a card in real life. Unlimited number of each, nested folders optional.
- Each entry: card printing, quantity, finish (nonfoil, foil, etched), language, condition, purchase price and purchase currency, misprint flag, altered flag, notes, tags, date added. Same printing with different properties = different stacks.
- **Bulk edit:** long-press or checkbox multi-select, "select all in this binder", edit any property for all selected, delete, **partial move** of N copies from a stack to another binder/list/deck.
- **Add complete set** to a binder or list from a set picker.
- **Collector mode:** shows owned and missing cards as a grid, grouped by set, card type, color or rarity (groupings can be nested, for example set then color), sortable by total cards, collected cards, completion percentage. Works with any search filter (for example "all Dragons"). "Group printings" option to count a card as collected if I own any printing, and a "reprint" filter to see only new cards I do not own in any version.
- **Value tracking:** total value per binder, list, deck and whole collection; change versus purchase price (absolute and percent). If purchase price is empty, default to the price on the day the card was added. Choose preferred provider and reference price (for example low, trend, market, average) per user; fall back to the next provider if a price is missing.
- Daily collection-value snapshots and a history chart; best and worst movers.
- **Watchlist / favorites** and **price alerts** (above or below a threshold, or percent change) delivered by ntfy and shown in the app.
- Import and export: see 6.6.

### 6.3 Decks (required)

- Create a deck with name and format (Commander, Brawl, Standard, Pioneer, Modern, Legacy, Vintage, Pauper, Oathbreaker, casual, custom). Boards: main, sideboard, maybeboard, commander(s) (support **partner** and background pairings), tokens/considering. Move cards between boards in bulk.
- Add cards through the search, choosing the printing, with the same advanced filters, plus a **"only cards in my collection"** filter and a board selector. Change a card's printing and board after adding.
- **Basic lands:** add from search or from a land menu, and **autofill lands** based on the mana symbols in the deck.
- **Tags/categories** per card (ramp, removal, draw, ...) with grouping and filtering. Suggest tags automatically from oracle text as a hint, never as a silent overwrite.
- **Statistics:** mana value curve, mana production, mana cost (color pip) distribution, type distribution, tokens produced by the cards in the list, average mana value, land count, color identity. Format legality check with a clear list of illegal cards and reasons (banned, restricted, color identity, copy limits, singleton).
- **Deck value:** total by provider, with options to ignore boards, ignore basic lands, or consider only some tags. "Buy missing cards" link-out to TCGplayer or Card Kingdom using Scryfall `purchase_uris` or the stores' official list-import links.
- **Simulator (goldfish):** random opening hand, London mulligan, draw, shuffle, scry, zones (library, hand, battlefield, graveyard, exile, command zone), tap/untap, counters, create tokens, undo, reset. Local only, no rules enforcement.
- **Commander recommendations:** card suggestions for the chosen commander. ManaBox uses EDHREC for this. EDHREC has no official public API that I know of, so implement it as an optional, best-effort adapter: cached, rate-limited, isolated behind an interface, and the feature must degrade gracefully when it breaks. Check EDHREC's terms before enabling by default.
- **Explore** section with official preconstructed decks and starter kits that I can import with one click (take the lists from the MTGJSON deck files, verify their license and format first, and map them to Scryfall printings; do not scrape deck sites).
- **Deck sharing:** read-only share link (random token, revocable, LAN or internet depending on how I expose it) and plain-text export. Shared links update only when I press "update link", like ManaBox.
- **Deck history:** every save creates a lightweight revision so I can diff and roll back.

### 6.4 Decks in the collection and missing cards (required)

- A deck can be **registered** as a physical deck in the collection in two ways: **Add cards** (create new collection entries for the deck, for example when I buy a precon) or **Build from collection** (find the cards in my binders and other decks, show where each one is, then **move** them into the deck on confirm).
- Matching rules: first exact match on set and finish, then other printings of the same card; configurable (prefer same set, prefer cheapest printing, allow foil for nonfoil, ignore language, ...). Let me override the choice per card, and mark chosen cards as "add as new entry" per card or for all missing ones.
- **Update** a registered deck after editing the decklist (show cards still in the deck and cards to remove). **Disassemble** a deck: choose a destination binder for the cards; the decklist stays, only the physical association is removed.
- **Missing cards** view per deck and a global "which of my decks can I build now" view. Export missing cards as text, copy them to a list, or buy them.
- "In which decks and binders is this card?" available from any card.

### 6.5 Scanner (required, the hardest part, build it in two steps)

The goal is to add cards to the collection by pointing a phone camera at them, from the PWA. ManaBox's documentation says its scanner recognizes cards **by artwork**, then lets you pick the version (with an automatic "quick mode" that takes the first matching version, and a stricter mode that asks when ambiguous). Reproduce that behavior.

- **Capture:** `getUserMedia` (rear camera, continuous focus where supported), session-based scanning: scan many cards, review everything afterwards in a "scanned cards" overview, bulk edit (quantity, foil, language, condition, purchase price, altered, misprint), delete, then save to a chosen binder or list. Also show for each scanned card whether I already own it, whether it is on a list, and in which decks it appears.
- **Controls:** normal/foil toggle, set and language selector, copies counter, tap to scan the same card again, **set lock** (lock one or more sets so recognition is restricted to them), "prefer foil" option, optional sound, running total value of the session (option to ignore cards under a given value).
- **Recognition pipeline (server side, deterministic first):**
  1. Client sends a frame (or a perspective-corrected crop of the card).
  2. Step one MVP: an on-screen card-shaped guide so the user aligns the card; fixed crop of the art region. Step two: automatic card detection (contours, perspective warp, for example with OpenCV.js or a WASM build) with a plain background tip in the UI, as ManaBox recommends (plain contrasting background, good light, no glare, no overlapping cards).
  3. Compute a perceptual hash (for example 256-bit dHash/pHash variants over the art crop, rotation-tolerant if cheap) and compare with the index built from the Scryfall `unique_artwork` images (one hash per `illustration_id`). Use Hamming distance with an in-memory index (linear scan or BK-tree; the set is only tens of thousands of entries).
  4. Resolve the illustration to a printing: restricted by the set lock, or by OCR of the collector number and set code in the bottom-left of the card (Tesseract.js or server-side Tesseract), or by asking the user among the top candidates. Return the top N candidates with confidence.
  5. As a fallback, OCR the card name and fuzzy-match it against the card database.
- **Quality bar:** build an evaluation harness. Generate synthetic test frames from Scryfall images (random perspective, blur, glare, noise, background) and report top-1 and top-5 accuracy; and let me drop a folder of my own real photos into `tests/scanner-fixtures/` to get the same report. Target at least 95% top-1 on clean photos before shipping the scanner. If accuracy is lower, say so and propose the next step (for example an embedding model) instead of hiding it.
- Image index build is a background job with progress, resumable, and it only downloads the artworks it does not already have.

### 6.6 Import, export, sharing (required)

- **Collection CSV import** with tolerant header mapping. Minimum: card name plus set code or set name, or a Scryfall ID. Recognized columns: name, set code / set name, quantity, foil, collector number, language, condition, purchase price, purchase currency, misprint, altered, Scryfall ID. Also recognize the CSV dialects of ManaBox, Moxfield, Archidekt, Deckbox, TCGplayer app exports (including product/TCGplayer IDs) and Cardmarket. On failures show a summary with line numbers and reasons, import only the valid rows, and let me **download a CSV of the failed rows** to fix and re-import.
- **Collection CSV export** (whole collection, or one binder or list) with all properties and the binder/list name.
- **Decklist text import/export** in the MTG Arena style (`4 Tarmogoyf`, `3 Verdant Catacombs (MH2) 260`; set and number optional), tolerant of other common text formats (MTGO, Moxfield text, section headers like `Commander`, `Sideboard`). Custom text export with grouping options and a "without version information" mode (names only), also usable to export missing cards.
- **Deck URL import** from sites ManaBox supports: Aetherhub, Archidekt, Deckstats, Moxfield, MTGTop8, Scryfall, TCGplayer, Untapped.gg. These are optional per-site adapters that fetch a public deck page or export endpoint on demand, one deck at a time, with a clear error if the site blocks or changes. Do not crawl. If a site's terms or technical measures forbid automated access, ship the adapter disabled and tell me.
- Full-data JSON export and import (all my data, lossless) for backup and migration.

### 6.7 Sync, multi-device and recovery (replaces ManaBox "Cloud Sync" and "Restore points")

- Because the server holds the data, every device sees the same collection in real time (server-sent events or websockets for live updates, with optimistic UI and conflict handling on edits).
- **Restore points:** automatic snapshots before bulk operations and imports; a page to list them and roll back a change set without touching the rest. Retention configurable.

### 6.8 Extras beyond ManaBox (lowest priority, only after the rest is done)

- Combo detection and bracket estimate for Commander decks through the Commander Spellbook backend (documented endpoints `find-my-combos` and `estimate-bracket`; check the live Swagger for the current contract). Show combos in the deck, "one card away" suggestions, and the estimated Commander bracket with the Game Changers found (derive Game Changers from Scryfall data if a flag or search keyword exists; verify).
- An optional RSS/news feed page (ManaBox has a news feed): a list of configurable RSS URLs, shown with titles and links only, no content copying.
- Wishlist matching: highlight cards of my lists that appear in my decks' missing cards.

## 7. Data model sketch (adjust during planning)

`users`, `sessions`, `cards` (Scryfall printings), `oracle_cards`, `sets`, `rulings`, `symbols`, `price_snapshots(card_id, provider, finish, currency, value, date)`, `collection_containers(id, user_id, kind[binder|list|deck], name, parent_id, sort)`, `collection_entries(id, container_id, card_id, qty, finish, lang, condition, purchase_price, purchase_currency, misprint, altered, notes, added_at)`, `entry_tags`, `decks(id, user_id, name, format, registered_container_id?, share_token?)`, `deck_cards(deck_id, board, card_id, qty, tags)`, `deck_revisions`, `alerts`, `scan_sessions`, `scan_items`, `art_hashes(illustration_id, hash, image_etag)`, `restore_points`, `jobs`, `settings`.

Collection entries reference a **Scryfall printing id**, never copy card data. Ingest must never delete a card that is referenced by user data (mark as superseded and keep the row).

## 8. API and security

- REST + JSON, OpenAPI published at `/api/docs` for logged-in users, versioned under `/api/v1`.
- Per-user data isolation enforced in the data layer, with tests that prove a user cannot read or modify another user's data.
- Argon2id passwords, secure session cookies (`HttpOnly`, `SameSite=Lax`, `Secure`), CSRF protection for cookie-authenticated mutations, rate limiting on auth and import endpoints, strict upload size and type limits, CSP header, no inline secrets.
- Forward-auth mode only trusts headers from `TRUSTED_PROXIES`. Everything else is rejected.
- Imports from URLs: server-side allow-list of hostnames per adapter, no redirects to private IP ranges (SSRF protection), timeouts and size caps.

## 9. Milestones and acceptance criteria

| # | Milestone | Done when |
|---|-----------|-----------|
| M0 | Scaffold | Repo layout, CI, Dockerfile, `compose.yaml` + `compose.dev.yaml`, Traefik labels, `/healthz`, migrations, i18n skeleton, auth (local + forward-auth), admin jobs page |
| M1 | Card database and search | Full Scryfall ingest from bulk data in a few minutes on my server; resumable; search with all filters in under 200 ms for typical queries; card detail page with rulings, legalities, printings, prices |
| M2 | Collection | Binders, lists, entries with all properties, bulk edit, partial move, add whole set, collector mode, value tracking, CSV import with error report and CSV export, restore points |
| M3 | Prices and alerts | Daily snapshots, provider and reference-price settings, history charts, collection value history, ntfy alerts, "prices as of" labels everywhere |
| M4 | Decks | Deck builder with boards, partner commanders, stats, legality, land autofill, tags, value, text import/export, URL import adapters, share link, revisions, explore precons |
| M5 | Decks in the collection | Register (add / build from collection), update, disassemble, missing cards, global buildable-decks view |
| M6 | Scanner step 1 | Guided camera capture, art-hash recognition, set lock, session review and bulk edit, evaluation harness with report |
| M7 | Goldfish simulator | Simulator with zones, mulligan, tokens, undo |
| M8 | Scanner step 2 and extras | Auto card detection and perspective correction, OCR set/number resolution, EDHREC recommendations adapter, combos and bracket estimate, RSS feed |
| M9 | Hardening | Backup/restore drill, load test with a 50,000-entry collection, accessibility pass, docs |

## 10. Quality bar

- Unit tests for parsers, price logic, matching rules (build from collection), format legality, collector grouping; integration tests for ingest with a small Scryfall fixture; Playwright flows for: import CSV, build deck, register deck, scan (with a stubbed camera feed).
- Lint, type-check, and tests run in CI on every push; Docker image built in CI.
- Performance budgets: first meaningful paint under 2 s on a mid-range phone over LAN; collection grid scrolls smoothly with 20,000+ entries.
- Accessibility: keyboard navigation on desktop, labels and contrast checked, no information conveyed by color alone (important for mana colors).
- Never silently drop or alter user data. Every destructive action has confirmation and a restore point.

## 11. Questions to ask me (one batch, with defaults)

1. Public hostname and certificate approach for Traefik (default: `cards.home` with my local CA).
2. Authentication mode (default: local accounts, with optional Authelia headers).
3. Do I want Italian card names (needs the large `all_cards` bulk file)? Default: no, English names with an option to enable.
4. Which price providers and currency: default Scryfall (TCGplayer USD, Cardmarket EUR), main currency EUR; add MTGJSON as optional source?
5. Can I provide a folder of real scan photos for the scanner evaluation (default: start with synthetic tests only)?

## 12. Reference sources (fetch these, do not rely on memory)

- Scryfall API docs and usage rules: https://scryfall.com/docs/api
- Scryfall rate limits: https://scryfall.com/docs/api/rate-limits
- Scryfall card objects and bulk data: https://scryfall.com/docs/api/cards and https://scryfall.com/docs/api/bulk-data
- MTGJSON (data files, price formats): https://mtgjson.com
- Commander Spellbook backend (Swagger): https://backend.commanderspellbook.com/schema/swagger/
- ManaBox user guides (feature behavior to match): https://manabox.app/guides/general/prices-in-the-app/ , https://manabox.app/guides/decks/getting-started/ , https://manabox.app/guides/decks/collection-decks/ , https://manabox.app/guides/decks/missing-cards/ , https://manabox.app/guides/decks/import-export/ , https://manabox.app/guides/collection/getting-started/ , https://manabox.app/guides/collection/collector-mode/ , https://manabox.app/guides/collection/import-export/ , https://manabox.app/guides/scanner/getting-started/ , https://manabox.app/guides/sync/cloud-sync/ , https://manabox.app/guides/search/getting-started/
- Prior art for scanning (contour detection plus perceptual hashing): https://github.com/hj3yoo/mtg_card_detector