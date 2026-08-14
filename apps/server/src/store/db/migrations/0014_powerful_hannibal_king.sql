CREATE TABLE `resource_references` (
	`session_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`resource_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `resource_references_conversation_idx` ON `resource_references` (`session_id`,`conversation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `resource_references_conversation_resource` ON `resource_references` (`conversation_id`,`resource_id`);--> statement-breakpoint
CREATE TABLE `resources` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`uri` text NOT NULL,
	`author_participant_id` text,
	`meta` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `resources_session_idx` ON `resources` (`session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `resources_session_uri` ON `resources` (`session_id`,`uri`);--> statement-breakpoint
INSERT OR IGNORE INTO `resources` (`id`, `session_id`, `kind`, `name`, `uri`, `author_participant_id`, `meta`, `created_at`) SELECT lower(hex(randomblob(16))), `session_id`, 'artifact', `title`, `path`, NULL, NULL, `pinned_at` FROM `session_assets`;