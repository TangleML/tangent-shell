import type { Resource, ResourceKind } from "@tangent/shared/contracts";
import type { IconName } from "@tangent/ui-primitives/icon";

/** Leading icon per catalogued-resource kind. */
export const RESOURCE_ICON: Record<ResourceKind, IconName> = {
  artifact: "FileText",
  file: "File",
  attachment: "Paperclip",
  memory: "Brain",
};

/** Human-readable label for a resource's kind, shown as its subtitle. */
export function resourceKindLabel(kind: ResourceKind): string {
  switch (kind) {
    case "artifact":
      return "Artifact";
    case "file":
      return "File";
    case "attachment":
      return "Attachment";
    case "memory":
      return "Memory";
  }
}

/** The secondary line beneath a resource's name: its kind and, when known, author. */
export function resourceSubtitle(resource: Resource): string {
  const kind = resourceKindLabel(resource.kind);
  if (!resource.authorParticipantId) return kind;
  return `${kind} · ${resource.authorParticipantId}`;
}
