CREATE TABLE `conversations` (
	`id` text NOT NULL,
	`session_id` text NOT NULL,
	`next_seq` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `conversations_session_idx` ON `conversations` (`session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `conversations_session_id` ON `conversations` (`session_id`,`id`);