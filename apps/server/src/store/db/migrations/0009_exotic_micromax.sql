CREATE TABLE `memberships` (
	`participant_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`session_id` text NOT NULL,
	`reaction` text DEFAULT 'never' NOT NULL,
	`ingress` text DEFAULT 'reaction' NOT NULL,
	`transcript_visibility` text DEFAULT 'shared' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memberships_session_conversation_idx` ON `memberships` (`session_id`,`conversation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_session_conversation_participant` ON `memberships` (`session_id`,`conversation_id`,`participant_id`);--> statement-breakpoint
INSERT OR IGNORE INTO `memberships` (`participant_id`, `conversation_id`, `session_id`, `reaction`, `ingress`, `transcript_visibility`, `created_at`)
SELECT `id`, `id`, `session_id`,
  CASE WHEN `connector_kind` = 'external-inbound' OR (`connector_kind` IS NULL AND `host` = 'external') THEN 'never' ELSE 'fromHumans+mentionsMe' END,
  'reaction',
  CASE WHEN `connector_kind` = 'external-inbound' OR (`connector_kind` IS NULL AND `host` = 'external') THEN 'opaque' ELSE 'shared' END,
  `created_at`
FROM `session_agents` WHERE `role` = 'subagent';--> statement-breakpoint
INSERT OR IGNORE INTO `memberships` (`participant_id`, `conversation_id`, `session_id`, `reaction`, `ingress`, `transcript_visibility`, `created_at`)
SELECT 'prime', `id`, `session_id`,
  CASE WHEN `auto_relay_to_prime` = 1 THEN 'atRunEnd+mentionsMe' ELSE 'mentionsMe' END,
  'reaction', 'shared', `created_at`
FROM `session_agents` WHERE `role` = 'subagent';--> statement-breakpoint
INSERT OR IGNORE INTO `memberships` (`participant_id`, `conversation_id`, `session_id`, `reaction`, `ingress`, `transcript_visibility`, `created_at`)
SELECT 'prime', 'prime', `id`, 'fromHumans+mentionsMe', 'reaction', 'shared', `created_at` FROM `sessions`;