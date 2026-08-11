ALTER TABLE `session_agents` ADD `connector_kind` text;--> statement-breakpoint
ALTER TABLE `session_agents` ADD `connector_lifecycle` text;--> statement-breakpoint
ALTER TABLE `session_agents` ADD `connector_environment_id` text;--> statement-breakpoint
UPDATE `session_agents` SET
  `connector_kind` = CASE `host`
    WHEN 'remote' THEN 'remote-env'
    WHEN 'external' THEN 'external-inbound'
    ELSE 'pi-stdio'
  END,
  `connector_lifecycle` = 'owned'
WHERE `connector_kind` IS NULL;
