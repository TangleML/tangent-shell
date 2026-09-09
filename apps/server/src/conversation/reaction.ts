import type {
  ChatMessage,
  MessageSourceKind,
  ReactionName,
  ReactionSpec,
  RunId,
} from "@tangent/shared/contracts.ts";

/**
 * The envelope facts a {@link Reaction} may read. Predicates see structured
 * addressing and provenance, never the body: free-text parsing is hostile to
 * rename and spoofing, so nothing downstream regexes content to decide whether
 * a participant runs.
 */
export interface MessageFacts {
  conversationId: string;
  seq: number;
  authorId: string;
  sourceKind: MessageSourceKind;
  /** The participant it originated from, when distinct from the author. */
  sourceFrom?: string;
  mentions: string[];
  endsRun: boolean;
  runId?: RunId;
}

/** Whether `self` should act on a Message posted to a Conversation it is in. */
export type Reaction = (message: MessageFacts, self: string) => boolean;

const PRESETS: Record<ReactionName, Reaction> = {
  always: () => true,
  fromHumans: (message) => message.sourceKind === "human",
  mentionsMe: (message, self) => message.mentions.includes(self),
  atRunEnd: (message) => message.endsRun,
  never: () => false,
};

/** Whether a stored token names a preset this server knows. */
export function isReactionName(value: string): value is ReactionName {
  return Object.hasOwn(PRESETS, value);
}

/** The stored form of a composed reaction. */
export function reactionSpec(...names: ReactionName[]): ReactionSpec {
  return names.join("+");
}

/**
 * Reads a stored spec as the disjunction of the presets it names. Unreadable
 * tokens are dropped, and a spec that names nothing recognizable never reacts:
 * inventing a reaction for a value we cannot read is how a cascade starts.
 */
export function parseReaction(spec: ReactionSpec): Reaction {
  const named = spec
    .split("+")
    .map((token) => token.trim())
    .filter(isReactionName);
  if (named.length === 0) return PRESETS.never;
  return (message, self) => named.some((name) => PRESETS[name](message, self));
}

/** Projects a persisted Message onto the facts a predicate is allowed to read. */
export function messageFacts(message: ChatMessage): MessageFacts {
  return {
    conversationId: message.conversationId,
    seq: message.seq,
    authorId: message.author.id,
    sourceKind: message.source.kind,
    sourceFrom: message.source.from,
    mentions: message.mentions,
    endsRun: message.endsRun ?? false,
    runId: message.runId,
  };
}
