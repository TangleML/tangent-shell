import type { RemoteEnvironmentInfo } from "@tangent/shared/contracts";

import { ListItem } from "@/shared/ui/patterns/list-item";

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Drops the `<sessionId>:` prefix a session-pinned dev host carries in its id. */
function environmentLabel(environmentId: string): string {
  const idx = environmentId.indexOf(":");
  return idx === -1 ? environmentId : environmentId.slice(idx + 1);
}

function environmentDetail(environment: RemoteEnvironmentInfo): string {
  const kind = environment.scoped ? "Session host" : "Dev host";
  return environment.owner ? `${kind} · ${environment.owner}` : kind;
}

/** A connected remote environment, listed read-only alongside the roster. */
export function EnvironmentRow({
  environment,
}: {
  environment: RemoteEnvironmentInfo;
}) {
  return (
    <ListItem
      icon="Monitor"
      title={environmentLabel(environment.environmentId)}
      subtitle={[
        environmentDetail(environment),
        plural(environment.toolCount, "tool"),
        plural(environment.subagentCount, "agent"),
      ].join(" · ")}
      flair={{ kind: "dot", label: "Connected", tone: "success" }}
    />
  );
}
