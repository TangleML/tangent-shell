import { ResourceList } from "../sidebar/resources/ResourceList";
import { useSessionChatWindowsContext } from "./SessionChatWindowsContext";

export function ResourcesWindow() {
  const { resources, onOpenResource } = useSessionChatWindowsContext();

  return <ResourceList resources={resources} onOpen={onOpenResource} />;
}
