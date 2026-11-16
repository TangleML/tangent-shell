import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ArtifactQueryKeys } from "@/features/chat/model/artifactQueryKeys";

/**
 * Re-reads an open artifact from disk. A body that fetched the file's text
 * refetches it; a framed body has nothing to refetch, so it takes `reloadCount`
 * as its `key` and remounts instead.
 */
export function useArtifactReload(url: string) {
  const queryClient = useQueryClient();
  const [reloadCount, setReloadCount] = useState(0);

  function reload() {
    setReloadCount((count) => count + 1);
    void queryClient.invalidateQueries({
      queryKey: ArtifactQueryKeys.Text(url),
    });
  }

  return { reloadCount, reload };
}
