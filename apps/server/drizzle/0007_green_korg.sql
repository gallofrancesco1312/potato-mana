CREATE TABLE `containers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`parent_id` integer,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `containers_user_idx` ON `containers` (`user_id`,`kind`);--> statement-breakpoint
CREATE TABLE `entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`container_id` integer NOT NULL,
	`card_id` text NOT NULL,
	`qty` integer NOT NULL,
	`finish` text DEFAULT 'nonfoil' NOT NULL,
	`lang` text DEFAULT 'en' NOT NULL,
	`condition` text DEFAULT 'NM' NOT NULL,
	`purchase_price` real,
	`purchase_currency` text,
	`misprint` integer DEFAULT 0 NOT NULL,
	`altered` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`added_eur` real,
	`added_usd` real,
	`added_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`container_id`) REFERENCES `containers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `entries_container_idx` ON `entries` (`container_id`);--> statement-breakpoint
CREATE INDEX `entries_user_card_idx` ON `entries` (`user_id`,`card_id`);--> statement-breakpoint
CREATE TABLE `restore_points` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`label` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`container_count` integer NOT NULL,
	`entry_count` integer NOT NULL,
	`data` blob NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `restore_user_idx` ON `restore_points` (`user_id`);