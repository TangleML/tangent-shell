import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type AgentTemplate,
  parseReaction,
  resolveSubagentConfig,
} from "./agentConfig.ts";

function templateMap(
  overrides: Partial<AgentTemplate> = {},
): Map<string, AgentTemplate> {
  const template: AgentTemplate = {
    name: "worker",
    description: "",
    systemPrompt: "Do the task.",
    ...overrides,
  };
  return new Map([[template.name, template]]);
}

test("parseReaction maps the frontmatter key to autoRelayToPrime", () => {
  assert.equal(parseReaction("onRunEnd"), true);
  assert.equal(parseReaction("onReport"), false);
  assert.equal(parseReaction(" onReport "), false);
  assert.equal(parseReaction(undefined), undefined);
  assert.equal(parseReaction("nonsense"), undefined);
});

test("resolveSubagentConfig reads autoRelayToPrime off the template", () => {
  const config = resolveSubagentConfig(
    { name: "w", template: "worker" },
    { templates: templateMap({ autoRelayToPrime: false }) },
  );

  assert.equal(config.autoRelayToPrime, false);
});

test("an inline request overrides the template's reaction mode", () => {
  const config = resolveSubagentConfig(
    { name: "w", template: "worker", autoRelayToPrime: true },
    { templates: templateMap({ autoRelayToPrime: false }) },
  );

  assert.equal(config.autoRelayToPrime, true);
});

test("a bundle default applies when neither request nor template sets it", () => {
  const config = resolveSubagentConfig(
    { name: "w", template: "worker" },
    { templates: templateMap(), defaults: { autoRelayToPrime: false } },
  );

  assert.equal(config.autoRelayToPrime, false);
});

test("an onReport sub-agent gets the report-or-stay-silent contract", () => {
  const config = resolveSubagentConfig(
    { name: "w", template: "worker" },
    { templates: templateMap({ autoRelayToPrime: false }) },
  );

  assert.match(config.appendSystemPrompt, /## Reporting to Prime/);
  assert.match(
    config.appendSystemPrompt,
    /Prime does not see your intermediate turns/,
  );
});

test("the default (onRunEnd) sub-agent gets the auto-delivered contract", () => {
  const config = resolveSubagentConfig(
    { name: "w", template: "worker" },
    { templates: templateMap() },
  );

  assert.equal(config.autoRelayToPrime, undefined);
  assert.match(
    config.appendSystemPrompt,
    /Your finalized reply is delivered to Prime automatically/,
  );
});
