ALTER TABLE `conversations` ADD `agent_id` text;--> statement-breakpoint
CREATE INDEX `conversations_session_agent_idx` ON `conversations` (`session_id`,`agent_id`);--> statement-breakpoint
UPDATE `conversations` SET `agent_id` = `id` WHERE `agent_id` IS NULL;