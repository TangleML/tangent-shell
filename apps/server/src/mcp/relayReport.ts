import type { ConnectorRegistry } from "../connectors/connectorRegistry.ts";
import { subagentAuthor } from "../connectors/participantAuthor.ts";
import type { ConversationRouter } from "../conversation/conversationRouter.ts";
import {
  homeConversationFor,
  orchestratorIdFor,
} from "../conversation/participantRegistry.ts";
import type { SessionStore } from "../store/sessionStore.ts";
import type { RelayChannel } from "./relayRegistry.ts";

/** Carries what a relay peer said back into the session it belongs to. */
export type RelayReport = (
  channel: RelayChannel,
  text: string,
) => Promise<void>;

/**
 * How a peer's words enter the session, in the two cases a channel can be in.
 *
 * A channel a connector opened **for a participant** reports as that
 * participant: the text is posted in its own Conversation addressed to Prime,
 * which is the same act `message_prime` performs for a local sub-agent. Its
 * words therefore appear in its own tab, are attributed to it, and wake Prime
 * because they mention it — not because the relay knows who to poke.
 *
 * A channel nobody owns has no standing in any Conversation, so there is nowhere
 * to post: its text is delivered to Prime with the peer's label, which is what
 * the relay has always done.
 */
export function createRelayReport(
  connectors: ConnectorRegistry,
  conversations: ConversationRouter,
  store: SessionStore,
): RelayReport {
  return async (channel, text) => {
    const orchestratorId = await orchestratorIdFor(store, channel.sessionId);
    const author = channel.participantId
      ? subagentAuthor(connectors, channel.sessionId, channel.participantId)
      : undefined;

    if (!author) {
      connectors.resolve(channel.sessionId, orchestratorId).deliver({
        sessionId: channel.sessionId,
        participantId: orchestratorId,
        text: `Remote agent (${channel.label}) reports:\n\n${text}`,
      });
      return;
    }

    await conversations.post({
      sessionId: channel.sessionId,
      conversationId: await homeConversationFor(
        store,
        channel.sessionId,
        author.id,
      ),
      author,
      content: text,
      mentions: [orchestratorId],
      ingress: "tool",
    });
  };
}
