CREATE TABLE `cards` (
	`id` text PRIMARY KEY NOT NULL,
	`oracle_id` text NOT NULL,
	`name` text NOT NULL,
	`lang` text NOT NULL,
	`set_code` text NOT NULL,
	`set_name` text NOT NULL,
	`set_type` text NOT NULL,
	`collector_number` text NOT NULL,
	`collector_int` integer DEFAULT 0 NOT NULL,
	`released_at` text NOT NULL,
	`rarity` text NOT NULL,
	`artist` text,
	`illustration_id` text,
	`border_color` text,
	`finishes` text DEFAULT '[]' NOT NULL,
	`frame_effects` text DEFAULT '[]' NOT NULL,
	`promo_types` text DEFAULT '[]' NOT NULL,
	`digital` integer DEFAULT 0 NOT NULL,
	`reprint` integer DEFAULT 0 NOT NULL,
	`promo` integer DEFAULT 0 NOT NULL,
	`full_art` integer DEFAULT 0 NOT NULL,
	`images` text DEFAULT '[]' NOT NULL,
	`tcgplayer_id` integer,
	`cardmarket_id` integer,
	`mtgo_id` integer,
	`usd` real,
	`usd_foil` real,
	`usd_etched` real,
	`eur` real,
	`eur_foil` real,
	`eur_etched` real,
	`tix` real,
	`purchase_uris` text,
	`scryfall_uri` text,
	`superseded` integer DEFAULT 0 NOT NULL,
	`ingest_id` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cards_oracle_idx` ON `cards` (`oracle_id`);--> statement-breakpoint
CREATE INDEX `cards_set_idx` ON `cards` (`set_code`,`collector_int`);--> statement-breakpoint
CREATE INDEX `cards_released_idx` ON `cards` (`released_at`);--> statement-breakpoint
CREATE TABLE `oracles` (
	`oracle_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`layout` text NOT NULL,
	`mana_cost` text,
	`cmc` real DEFAULT 0 NOT NULL,
	`type_line` text,
	`oracle_text` text,
	`power` text,
	`toughness` text,
	`loyalty` text,
	`colors` integer DEFAULT 0 NOT NULL,
	`color_identity` integer DEFAULT 0 NOT NULL,
	`produced_mana` integer DEFAULT 0 NOT NULL,
	`keywords` text DEFAULT '[]' NOT NULL,
	`legalities` text DEFAULT '{}' NOT NULL,
	`faces` text,
	`game_changer` integer DEFAULT 0 NOT NULL,
	`edhrec_rank` integer
);
--> statement-breakpoint
CREATE TABLE `rulings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`oracle_id` text NOT NULL,
	`source` text NOT NULL,
	`published_at` text NOT NULL,
	`comment` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rulings_oracle_idx` ON `rulings` (`oracle_id`);--> statement-breakpoint
CREATE TABLE `sets` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`released_at` text,
	`set_type` text NOT NULL,
	`card_count` integer DEFAULT 0 NOT NULL,
	`digital` integer DEFAULT 0 NOT NULL,
	`icon_svg_uri` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sets_code_unique` ON `sets` (`code`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `symbols` (
	`symbol` text PRIMARY KEY NOT NULL,
	`svg_uri` text NOT NULL,
	`english` text
);
