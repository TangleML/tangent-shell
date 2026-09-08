INSERT OR IGNORE INTO `participants` (`id`, `session_id`, `kind`, `display_name`, `capabilities`, `presence`, `connector_kind`, `connector_lifecycle`, `connector_environment_id`, `connector_endpoint_url`, `agent_payload`, `created_at`)
SELECT `id`, `session_id`, 'agent', `name`,
  CASE WHEN `role` = 'prime' THEN '["orchestrator","supervisor"]' ELSE '[]' END,
  CASE WHEN `status` = 'detached' THEN 'detached' ELSE 'connected' END,
  `connector_kind`, `connector_lifecycle`, `connector_environment_id`, `connector_endpoint_url`,
  json_object(
    'role', `role`,
    'model', `model`,
    'thinkingDepth', `thinking_depth`,
    'template', `template`,
    'tools', CASE WHEN `tools` IS NULL THEN NULL ELSE json(`tools`) END,
    'systemPrompt', `system_prompt`,
    'autoRelayToPrime', CASE WHEN `auto_relay_to_prime` = 1 THEN json('true') ELSE json('false') END,
    'purpose', `purpose`,
    'status', `status`
  ),
  `created_at`
FROM `session_agents`;
--> statement-breakpoint
UPDATE `participants`
SET
  `display_name` = `sa`.`name`,
  `capabilities` = CASE WHEN `sa`.`role` = 'prime' THEN '["orchestrator","supervisor"]' ELSE '[]' END,
  `presence` = CASE WHEN `sa`.`status` = 'detached' THEN 'detached' ELSE 'connected' END,
  `connector_kind` = `sa`.`connector_kind`,
  `connector_lifecycle` = `sa`.`connector_lifecycle`,
  `connector_environment_id` = `sa`.`connector_environment_id`,
  `connector_endpoint_url` = `sa`.`connector_endpoint_url`,
  `agent_payload` = json_object(
    'role', `sa`.`role`,
    'model', `sa`.`model`,
    'thinkingDepth', `sa`.`thinking_depth`,
    'template', `sa`.`template`,
    'tools', CASE WHEN `sa`.`tools` IS NULL THEN NULL ELSE json(`sa`.`tools`) END,
    'systemPrompt', `sa`.`system_prompt`,
    'autoRelayToPrime', CASE WHEN `sa`.`auto_relay_to_prime` = 1 THEN json('true') ELSE json('false') END,
    'purpose', `sa`.`purpose`,
    'status', `sa`.`status`
  )
FROM `session_agents` `sa`
WHERE `participants`.`session_id` = `sa`.`session_id` AND `participants`.`id` = `sa`.`id`;
--> statement-breakpoint
DROP TABLE `session_agents`;