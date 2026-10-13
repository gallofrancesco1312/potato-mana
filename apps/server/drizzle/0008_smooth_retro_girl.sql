DROP INDEX `entries_container_idx`;--> statement-breakpoint
CREATE INDEX `entries_container_card_idx` ON `entries` (`container_id`,`card_id`);