import type { GlobalExtensionMeta } from "@tangent/shared/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  installExtensionFromFile,
  installExtensionFromSource,
  type InstallFromFileInput,
} from "@/features/global-extensions/api/globalExtensionsApi";
import { GlobalExtensionQueryKeys } from "@/features/global-extensions/model/globalExtensionQueryKeys";

export type InstallExtensionInput =
  | {
      kind: "source";
      source: string;
      id?: string;
      tools?: string[];
      replace?: boolean;
    }
  | ({ kind: "file" } & InstallFromFileInput);

function install(input: InstallExtensionInput): Promise<GlobalExtensionMeta> {
  if (input.kind === "file") {
    return installExtensionFromFile({
      file: input.file,
      id: input.id,
      tools: input.tools,
      replace: input.replace,
    });
  }
  return installExtensionFromSource({
    source: input.source,
    id: input.id,
    tools: input.tools,
    replace: input.replace,
  });
}

export function useInstallGlobalExtension() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: install,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: GlobalExtensionQueryKeys.All(),
      });
    },
  });
}
