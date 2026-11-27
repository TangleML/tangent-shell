CREATE TABLE `trigger_delegations` (
	`session_id` text NOT NULL,
	`trigger_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`delegation_id` text NOT NULL,
	`token` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`session_id`, `trigger_id`),
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
