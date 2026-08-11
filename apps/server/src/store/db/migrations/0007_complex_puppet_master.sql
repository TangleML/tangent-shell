CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`home_conversation_id` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`ingress` text NOT NULL,
	`external_id` text,
	`cursor` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`ended_at` text,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `runs_session_idx` ON `runs` (`session_id`);--> statement-breakpoint
CREATE INDEX `runs_session_participant_idx` ON `runs` (`session_id`,`participant_id`);