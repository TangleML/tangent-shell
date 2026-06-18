ALTER TABLE `session_agents` ADD `tools` text;--> statement-breakpoint
ALTER TABLE `session_agents` ADD `system_prompt` text;--> statement-breakpoint
ALTER TABLE `session_agents` ADD `auto_relay_to_prime` integer DEFAULT true NOT NULL;