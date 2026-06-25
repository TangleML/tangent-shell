import { Text } from "@tangent/ui-primitives/typography";

import { useSessionChatWindowsContext } from "./SessionChatWindowsContext";
import { WindowHeaderContent } from "./WindowHeaderContent";

export function AssetsWindowHeader() {
  const { assets } = useSessionChatWindowsContext();

  return (
    <WindowHeaderContent
      icon="LayoutGrid"
      title="Assets"
      suffix={
        assets.length > 0 ? (
          <Text size="xs" tone="subdued">
            {assets.length}
          </Text>
        ) : null
      }
    />
  );
}
