import { Icon } from "@tangent/ui-primitives/icon";
import { BlockStack, InlineStack } from "@tangent/ui-primitives/layout";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@tangent/ui-primitives/tabs";
import {
  DockArea,
  useWindowPersistence,
  WindowContainer,
  WindowStoreProvider,
} from "@tangent/windows";

import { CHAT_TAB_VALUE } from "@/features/chat/hooks/useAssetTabs";
import { useSessionChatModel } from "@/features/chat/hooks/useSessionChatModel";

import { PrimeChatPanel } from "./PrimeChatPanel";
import { SessionCard } from "./sidebar/sessions/SessionCard";
import { AssetTabContent } from "./tabs/AssetTabContent";
import { OpenedTabTrigger } from "./tabs/OpenedTabTrigger";
import { SessionChatWindowsContext } from "./windows/SessionChatWindowsContext";
import { useSessionChatWindows } from "./windows/useSessionChatWindows";

interface SessionChatProps {
  sessionId: string;
}

export function SessionChat({ sessionId }: SessionChatProps) {
  const {
    session,
    connected,
    tabs,
    activeTab,
    setActiveTab,
    closeAsset,
    subagents,
    windowsValue,
    primeChatPanelProps,
    sharedTabProps,
  } = useSessionChatModel(sessionId);

  return (
    <WindowStoreProvider>
      <SessionChatWindowsContext value={windowsValue}>
        <SessionChatWindowsMount />
        <BlockStack grow align="stretch">
          <InlineStack grow wrap="nowrap" blockAlign="stretch">
            <DockArea
              side="left"
              header={
                <SessionCard
                  currentSessionId={sessionId}
                  name={session?.name ?? "Session"}
                  rootPath={session?.rootPath}
                  connected={connected}
                />
              }
            />
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList>
                <TabsTrigger value={CHAT_TAB_VALUE}>
                  <Icon name="MessageSquare" size="xs" tone="subdued" />
                  Chat
                </TabsTrigger>
                {tabs.map((tab) => (
                  <OpenedTabTrigger
                    key={tab.id}
                    tab={tab}
                    sessionId={sessionId}
                    subagents={subagents}
                    onClose={() => closeAsset(tab.id)}
                  />
                ))}
              </TabsList>

              <TabsContent value={CHAT_TAB_VALUE} forceMount>
                <PrimeChatPanel {...primeChatPanelProps} />
              </TabsContent>

              {tabs.map((tab) => (
                <TabsContent key={tab.id} value={tab.id} forceMount>
                  <AssetTabContent tab={tab} {...sharedTabProps} />
                </TabsContent>
              ))}
            </Tabs>
            <DockArea side="right" />
          </InlineStack>
          <WindowContainer />
        </BlockStack>
      </SessionChatWindowsContext>
    </WindowStoreProvider>
  );
}

function SessionChatWindowsMount() {
  useWindowPersistence("session-chat");
  useSessionChatWindows();
  return null;
}
