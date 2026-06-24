CREATE TABLE `session_views` (
	`session_id` text NOT NULL,
	`user_key` text NOT NULL,
	`last_viewed_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_views_session_idx` ON `session_views` (`session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_views_session_user` ON `session_views` (`session_id`,`user_key`);