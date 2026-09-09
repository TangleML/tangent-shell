import { ResourceList } from "../sidebar/resources/ResourceList";
import { useSessionChatWindowsContext } from "./SessionChatWindowsContext";
import { WindowLoadError, WindowSpinner } from "./WindowStatus";

export function ResourcesWindow() {
  const { resources, resourcesPending, resourcesError, onOpenResource } =
    useSessionChatWindowsContext();

  if (resourcesPending) return <WindowSpinner />;
  if (resourcesError) {
    return (
      <WindowLoadError
        title="Couldn't load resources"
        description="The catalog is unavailable right now. It will refresh on its own."
      />
    );
  }

  return <ResourceList resources={resources} onOpen={onOpenResource} />;
}
