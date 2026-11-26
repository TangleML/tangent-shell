import type { ChatMessage as StoredChatMessage } from "@tangent/shared/contracts";

export type {
  AgentRole,
  Attachment,
  ChatAuthor,
  SubagentInfo,
  SubagentStatus,
} from "@tangent/shared/contracts";

export interface ChatMessage extends StoredChatMessage {
  /** A failed stream can leave its partial text on screen without a saved message. */
  streamingPlaceholder?: true;
}
