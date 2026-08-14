CREATE TABLE `resource_grants` (
	`session_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`resource_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `resource_grants_conversation_participant_idx` ON `resource_grants` (`session_id`,`conversation_id`,`participant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `resource_grants_conversation_participant_resource` ON `resource_grants` (`conversation_id`,`participant_id`,`resource_id`);