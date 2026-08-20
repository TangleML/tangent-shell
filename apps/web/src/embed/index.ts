import { defineAgentListElement } from "./elements/agent-list-element";
import { defineArtifactViewerElement } from "./elements/artifact-viewer-element";
import { defineAssetListElement } from "./elements/asset-list-element";
import { defineBundledUiElement } from "./elements/bundled-ui-element";
import { defineChatElement } from "./elements/chat-element";
import { defineParticipantListElement } from "./elements/participant-list-element";
import { defineProviderElement } from "./elements/provider-element";
import { defineResourceListElement } from "./elements/resource-list-element";
import { defineSessionListElement } from "./elements/session-list-element";

/**
 * Protocol version reported to the npm wrapper at registration. The wrapper
 * declares the range it supports and warns on mismatch; a breaking contract
 * change bumps the served channel to `/embed/v2/` rather than this number.
 */
export const EMBED_PROTOCOL_VERSION = 1;

declare global {
  interface Window {
    __TANGENT_EMBED__?: { protocolVersion: number };
  }
}

defineProviderElement();
defineChatElement();
defineSessionListElement();
defineAgentListElement();
defineAssetListElement();
defineResourceListElement();
defineParticipantListElement();
defineArtifactViewerElement();
defineBundledUiElement();

window.__TANGENT_EMBED__ = { protocolVersion: EMBED_PROTOCOL_VERSION };

export { TangentAgentListElement } from "./elements/agent-list-element";
export { TangentArtifactViewerElement } from "./elements/artifact-viewer-element";
export { TangentAssetListElement } from "./elements/asset-list-element";
export { TangentBundledUiElement } from "./elements/bundled-ui-element";
export { TangentChatElement } from "./elements/chat-element";
export { TangentParticipantListElement } from "./elements/participant-list-element";
export { TangentProviderElement } from "./elements/provider-element";
export { TangentResourceListElement } from "./elements/resource-list-element";
export { TangentSessionListElement } from "./elements/session-list-element";
export type {
  EmbedTheme,
  NewSessionOptions,
  NewSessionResult,
  TangentRuntime,
} from "./types";
