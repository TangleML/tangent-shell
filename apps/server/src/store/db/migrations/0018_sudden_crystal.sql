UPDATE `session_agents` SET
  `connector_kind` = CASE `host`
    WHEN 'remote' THEN 'remote-env'
    WHEN 'external' THEN 'external-inbound'
    ELSE 'pi-stdio'
  END,
  `connector_lifecycle` = COALESCE(`connector_lifecycle`, 'owned')
WHERE `connector_kind` IS NULL;--> statement-breakpoint
UPDATE `participants` SET
  `connector_kind` = CASE json_extract(`agent_payload`, '$.host')
    WHEN 'remote' THEN 'remote-env'
    WHEN 'external' THEN 'external-inbound'
    ELSE 'pi-stdio'
  END,
  `connector_lifecycle` = COALESCE(`connector_lifecycle`, 'owned')
WHERE `connector_kind` IS NULL;--> statement-breakpoint
ALTER TABLE `session_agents` DROP COLUMN `host`;