CREATE TABLE `participants` (
	`id` text NOT NULL,
	`session_id` text NOT NULL,
	`kind` text NOT NULL,
	`display_name` text NOT NULL,
	`capabilities` text DEFAULT '[]' NOT NULL,
	`presence` text DEFAULT 'connected' NOT NULL,
	`connector_kind` text,
	`connector_lifecycle` text,
	`connector_environment_id` text,
	`connector_endpoint_url` text,
	`agent_payload` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `participants_session_idx` ON `participants` (`session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `participants_session_id` ON `participants` (`session_id`,`id`);--> statement-breakpoint
INSERT OR IGNORE INTO `participants` (`id`, `session_id`, `kind`, `display_name`, `capabilities`, `presence`, `connector_kind`, `connector_lifecycle`, `connector_environment_id`, `connector_endpoint_url`, `agent_payload`, `created_at`)
SELECT `id`, `session_id`, 'agent', `name`,
  CASE WHEN `role` = 'prime' THEN '["orchestrator"]' ELSE '[]' END,
  'connected',
  `connector_kind`, `connector_lifecycle`, `connector_environment_id`, `connector_endpoint_url`,
  json_object(
    'role', `role`,
    'model', `model`,
    'thinkingDepth', `thinking_depth`,
    'template', `template`,
    'tools', CASE WHEN `tools` IS NULL THEN NULL ELSE json(`tools`) END,
    'systemPrompt', `system_prompt`,
    'autoRelayToPrime', CASE WHEN `auto_relay_to_prime` = 1 THEN json('true') ELSE json('false') END,
    'host', `host`,
    'purpose', `purpose`,
    'status', `status`
  ),
  `created_at`
FROM `session_agents`;