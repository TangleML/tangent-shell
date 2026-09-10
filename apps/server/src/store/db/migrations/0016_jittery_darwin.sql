CREATE TABLE `reactor_state` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`home_conversation_id` text NOT NULL,
	`scope_key` text NOT NULL,
	`spec` text NOT NULL,
	`scope` text NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reactor_state_session_idx` ON `reactor_state` (`session_id`);--> statement-breakpoint
CREATE INDEX `reactor_state_session_participant_idx` ON `reactor_state` (`session_id`,`participant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `reactor_state_session_participant_scope` ON `reactor_state` (`session_id`,`participant_id`,`scope_key`);