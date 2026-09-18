import type {
  ChatMessage,
  ContextDisposition,
  ContextPolicyView,
  ContextSummarizer,
  Resource,
  TokenBudget,
  TranscriptVisibility,
} from "@tangent/shared/contracts.ts";

import { type MessageFacts, messageFacts } from "./reaction.ts";
import type { ResourceCatalog } from "./resourceCatalog.ts";

/**
 * The projection a Membership's {@link TranscriptVisibility} expands to
 * (unified-model §9.6). `classify` decides each Message's disposition;
 * `budget`, when set, caps the verbatim band and downgrades the overflow to the
 * summarize band; `summarizer` says who — if anyone — turns that band into a
 * digest; `pinned` names ResourceReferences that stay regardless of budget.
 */
export interface ContextPolicy {
  budget?: TokenBudget;
  classify: (facts: MessageFacts, self: string) => ContextDisposition;
  summarizer: ContextSummarizer;
  pinned: string[];
}

/** A run of Messages, named by the `seq` of its first and last. */
export interface SeqRange {
  fromSeq: number;
  toSeq: number;
}

/** What one Participant reads of a Conversation after its policy is applied. */
export interface ContextProjection {
  /** The Messages kept verbatim, in `seq` order. */
  messages: ChatMessage[];
  /** Digest Resources standing in for the summarized ranges, oldest first. */
  digests: Resource[];
  /** Ranges shown as neither verbatim nor a digest, oldest first. */
  omitted: SeqRange[];
}

/** Everything {@link ContextEngine.project} needs for one read. */
export interface ContextProjectionInput {
  sessionId: string;
  conversationId: string;
  /** The Participant the projection is for — its `self` for `classify`. */
  participantId: string;
  /** The Conversation's Messages in `seq` order. */
  messages: ChatMessage[];
  policy: ContextPolicy;
}

/**
 * Produces the body of a digest for a summarized range. Injected so the engine
 * does not own summary quality — the default is a deterministic placeholder, and
 * the claim this PR makes is that a digest is attributable, ranged, and cached,
 * not that its text is good.
 */
export type Summarize = (range: SeqRange, count: number) => string;

/** The default summarized-band budget, in characters. Tests pass their own. */
export const DEFAULT_CONTEXT_BUDGET: TokenBudget = { maxChars: 8000 };

/** The Participant a digest is attributed to when a preset produces one. */
export const DIGEST_AUTHOR_ID = "digest";

/** The `memory://` scheme prefix every digest Resource is keyed under. */
const DIGEST_URI_PREFIX = "memory://digest/";

const defaultSummarize: Summarize = (range, count) =>
  `${count} messages (seq ${range.fromSeq}\u2013${range.toSeq}).`;

/**
 * The stable cache key for a digest of one range: same `(conversationId,
 * fromSeq, toSeq)` yields the same uri, so the catalog upsert returns the same
 * Resource id for every Membership whose policy asks for that range.
 */
function digestUri(conversationId: string, range: SeqRange): string {
  return `${DIGEST_URI_PREFIX}${conversationId}/${range.fromSeq}-${range.toSeq}`;
}

/**
 * The serializable snapshot of a visibility's {@link ContextPolicy}: the preset,
 * budget, summarizer, and pins, without the `classify` function that cannot
 * cross the wire. What the workflow view reports for a Membership (unified-model
 * §9.8).
 */
export function policyViewFor(
  visibility: TranscriptVisibility,
): ContextPolicyView {
  const policy = policyFor(visibility);
  return {
    visibility,
    budget: policy.budget,
    summarizer: policy.summarizer,
    pinned: policy.pinned,
  };
}

/** Expands a {@link TranscriptVisibility} into its {@link ContextPolicy} preset. */
export function policyFor(visibility: TranscriptVisibility): ContextPolicy {
  if (visibility === "opaque") {
    return {
      classify: (facts, self) =>
        facts.mentions.includes(self) || facts.authorId === self
          ? "verbatim"
          : "omit",
      summarizer: "none",
      pinned: [],
    };
  }
  if (visibility === "summarized") {
    return {
      budget: DEFAULT_CONTEXT_BUDGET,
      classify: () => "verbatim",
      summarizer: DIGEST_AUTHOR_ID,
      pinned: [],
    };
  }
  return { classify: () => "verbatim", summarizer: "none", pinned: [] };
}

/** The band one Message lands in once budget and classification are resolved. */
type Band = "verbatim" | "summarize" | "omit";

/**
 * Assigns each Message a band, newest-first so the budget is spent on the most
 * recent context. A `verbatim` Message that no longer fits is downgraded to the
 * summarize band; `omit` and an explicit `summarize` are budget-independent.
 */
function assignBands(
  messages: ChatMessage[],
  policy: ContextPolicy,
  self: string,
): Band[] {
  const bands: Band[] = new Array(messages.length).fill("omit");
  let spent = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    const intent = policy.classify(messageFacts(message), self);
    if (intent === "omit") continue;
    if (intent === "summarize") {
      bands[i] = "summarize";
      continue;
    }
    const cost = message.content.length;
    const fits = !policy.budget || spent + cost <= policy.budget.maxChars;
    if (!fits) {
      bands[i] = "summarize";
      continue;
    }
    bands[i] = "verbatim";
    spent += cost;
  }
  return bands;
}

/** A contiguous run of same-band Messages. */
interface BandRun {
  band: Band;
  fromSeq: number;
  toSeq: number;
  count: number;
}

/** Groups Messages into contiguous same-band runs, in `seq` order. */
function collectRuns(messages: ChatMessage[], bands: Band[]): BandRun[] {
  const runs: BandRun[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    const seq = messages[i].seq;
    const last = runs[runs.length - 1];
    if (last && last.band === bands[i]) {
      last.toSeq = seq;
      last.count += 1;
      continue;
    }
    runs.push({ band: bands[i], fromSeq: seq, toSeq: seq, count: 1 });
  }
  return runs;
}

/** Whether a summarizer names a Participant that authors Tangent digests. */
function producesDigest(summarizer: ContextSummarizer): boolean {
  return summarizer !== "none" && summarizer !== "connector";
}

/**
 * Turns a Membership's {@link TranscriptVisibility} into what its Participant
 * actually reads (unified-model §9.6). `shared` is everything verbatim; `opaque`
 * keeps only the Messages addressing the Participant; `summarized` spends a
 * character budget newest-first and folds the older band into digest Resources —
 * `Resource(kind: "memory")` keyed by `(conversationId, fromSeq, toSeq)`, so a
 * digest has an author and a range and one digest of a range serves every
 * Membership whose policy asks for it.
 *
 * A digest is written through the {@link ResourceCatalog} like any other
 * content, so a late join is an ordinary read — the older band as a digest, the
 * newer verbatim — with no backfill protocol.
 */
export class ContextEngine {
  private readonly catalog: ResourceCatalog;
  private readonly summarize: Summarize;

  constructor(
    catalog: ResourceCatalog,
    summarize: Summarize = defaultSummarize,
  ) {
    this.catalog = catalog;
    this.summarize = summarize;
  }

  /** Projects one Conversation onto what a Participant's policy lets it read. */
  async project(input: ContextProjectionInput): Promise<ContextProjection> {
    const { messages, policy, participantId } = input;
    const bands = assignBands(messages, policy, participantId);
    const runs = collectRuns(messages, bands);

    const kept = messages.filter((_, i) => bands[i] === "verbatim");
    const digests: Resource[] = [];
    const omitted: SeqRange[] = [];

    for (const run of runs) {
      if (run.band === "verbatim") continue;
      if (run.band === "omit") {
        omitted.push({ fromSeq: run.fromSeq, toSeq: run.toSeq });
        continue;
      }
      await this.foldSummarizeRun(
        input,
        run,
        policy.summarizer,
        digests,
        omitted,
      );
    }

    return { messages: kept, digests, omitted };
  }

  /** Every digest Resource covering a range of one Conversation. */
  async coverage(
    sessionId: string,
    conversationId: string,
  ): Promise<Resource[]> {
    const referenced = await this.catalog.listForConversation(
      sessionId,
      conversationId,
    );
    const prefix = `${DIGEST_URI_PREFIX}${conversationId}/`;
    return referenced.filter((resource) => resource.uri.startsWith(prefix));
  }

  /**
   * Resolves one summarize-band run: a digest when a Participant summarizer
   * owns it, an omitted range when nothing does, or nothing when the far end
   * compacts its own context (`"connector"`).
   */
  private async foldSummarizeRun(
    input: ContextProjectionInput,
    run: BandRun,
    summarizer: ContextSummarizer,
    digests: Resource[],
    omitted: SeqRange[],
  ): Promise<void> {
    const range: SeqRange = { fromSeq: run.fromSeq, toSeq: run.toSeq };
    if (summarizer === "connector") return;
    if (!producesDigest(summarizer)) {
      omitted.push(range);
      return;
    }
    digests.push(await this.catalogDigest(input, range, run.count, summarizer));
  }

  /** Catalogs (and references) the digest Resource for one range. */
  private async catalogDigest(
    input: ContextProjectionInput,
    range: SeqRange,
    count: number,
    summarizer: ContextSummarizer,
  ): Promise<Resource> {
    return this.catalog.catalogIn(input.conversationId, {
      sessionId: input.sessionId,
      kind: "memory",
      name: `Digest of seq ${range.fromSeq}\u2013${range.toSeq}`,
      uri: digestUri(input.conversationId, range),
      authorParticipantId: summarizer,
      meta: {
        conversationId: input.conversationId,
        fromSeq: range.fromSeq,
        toSeq: range.toSeq,
        count,
        summary: this.summarize(range, count),
      },
    });
  }
}

/** The Conversation-scoped read {@link projectRoom} needs from a store. */
interface ConversationMessages {
  getConversationMessages(
    sessionId: string,
    conversationId: string,
  ): Promise<ChatMessage[]>;
}

/** The Membership lookup {@link projectRoom} needs to resolve visibility. */
interface MembershipLookup {
  memberIn(
    sessionId: string,
    conversationId: string,
    participantId: string,
  ): Promise<{ transcriptVisibility: TranscriptVisibility } | undefined>;
}

/** One agent-facing room read, once its policy has been resolved. */
export interface RoomReadRequest {
  sessionId: string;
  conversationId: string;
  participantId: string;
  /** Tail length applied to the verbatim band after projection. */
  limit?: number;
}

/** What a projected room read returns: the verbatim tail plus its digests. */
export interface RoomReadResult {
  messages: ChatMessage[];
  digests: Resource[];
}

/**
 * The agent-facing read of one Conversation, projected through the reader's
 * {@link TranscriptVisibility}: `shared` reads the log, `opaque` only what
 * addresses it, `summarized` a budgeted tail plus digests. A reader that holds
 * no Membership defaults to `opaque` — it is sent only what named it, never the
 * whole thread. `limit` clamps the verbatim tail, so a digest is not truncated
 * away by the same bound.
 */
export async function projectRoom(
  engine: ContextEngine,
  store: ConversationMessages,
  memberships: MembershipLookup,
  request: RoomReadRequest,
): Promise<RoomReadResult> {
  const { sessionId, conversationId, participantId, limit } = request;
  const membership = await memberships.memberIn(
    sessionId,
    conversationId,
    participantId,
  );
  const policy = policyFor(membership?.transcriptVisibility ?? "opaque");
  const messages = await store.getConversationMessages(
    sessionId,
    conversationId,
  );
  const projection = await engine.project({
    sessionId,
    conversationId,
    participantId,
    messages,
    policy,
  });
  const kept =
    limit && limit > 0
      ? projection.messages.slice(-limit)
      : projection.messages;
  return { messages: kept, digests: projection.digests };
}
