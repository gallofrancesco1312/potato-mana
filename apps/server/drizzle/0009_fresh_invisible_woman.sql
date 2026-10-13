CREATE TABLE `alerts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`card_id` text NOT NULL,
	`finish` text DEFAULT 'nonfoil' NOT NULL,
	`kind` text NOT NULL,
	`threshold` real NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`armed` integer DEFAULT 1 NOT NULL,
	`last_triggered_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `alerts_user_idx` ON `alerts` (`user_id`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`card_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`read_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notifications_user_idx` ON `notifications` (`user_id`,`read_at`);--> statement-breakpoint
CREATE TABLE `price_points` (
	`card_id` text NOT NULL,
	`source` text NOT NULL,
	`finish` text NOT NULL,
	`date` text NOT NULL,
	`value` real,
	PRIMARY KEY(`card_id`, `source`, `finish`, `date`)
);
--> statement-breakpoint
CREATE TABLE `recent_views` (
	`card_id` text PRIMARY KEY NOT NULL,
	`viewed_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_settings` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`ntfy_topic` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `value_points` (
	`user_id` integer NOT NULL,
	`container_id` integer NOT NULL,
	`date` text NOT NULL,
	`currency` text NOT NULL,
	`value` real NOT NULL,
	`qty` integer NOT NULL,
	PRIMARY KEY(`user_id`, `container_id`, `date`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `watchlist` (
	`user_id` integer NOT NULL,
	`card_id` text NOT NULL,
	`added_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_id`, `card_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
