CREATE TABLE `session_agents` (
	`id` text NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`name` text NOT NULL,
	`purpose` text,
	`status` text DEFAULT 'active' NOT NULL,
	`model` text,
	`thinking_depth` text,
	`template` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_agents_session_idx` ON `session_agents` (`session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_agents_session_id` ON `session_agents` (`session_id`,`id`);--> statement-breakpoint
CREATE TABLE `session_assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`path` text NOT NULL,
	`title` text NOT NULL,
	`pinned_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_assets_session_idx` ON `session_assets` (`session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_assets_session_path` ON `session_assets` (`session_id`,`path`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`root_path` text NOT NULL,
	`status` text DEFAULT 'created' NOT NULL,
	`config` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
