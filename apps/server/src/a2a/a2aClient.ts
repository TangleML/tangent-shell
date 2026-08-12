import { randomUUID } from "node:crypto";

import {
  type Artifact,
  type Message,
  type Part,
  Role,
  type SendMessageRequest,
  type StreamResponse,
  type Task,
  type TaskArtifactUpdateEvent,
  TaskState,
  type TaskStatusUpdateEvent,
} from "@a2a-js/sdk";
import {
  type Client,
  ClientFactory,
  ClientFactoryOptions,
  DefaultAgentCardResolver,
  JsonRpcTransportFactory,
  RestTransportFactory,
} from "@a2a-js/sdk/client";

/**
 * What an Agent Card tells Tangent about a peer. Only the display facts: the
 * transport it speaks and whether it streams are the SDK's business.
 */
export interface A2aCard {
  name: string;
  description?: string;
}

/**
 * Where a peer's Task has got to, reduced to what a Run needs.
 * `input-required` is A2A's interrupted state: the peer stopped talking and
 * waits for more input, so the turn is over while the Task lives on.
 */
export type A2aTaskPhase =
  | "working"
  | "input-required"
  | "completed"
  | "failed"
  | "canceled";

/** One file's worth of an {@link A2aArtifact}. */
export interface A2aArtifactPart {
  filename: string;
  body: string | Uint8Array;
}

/** A peer's output, as something writable. */
export interface A2aArtifact {
  name: string;
  parts: A2aArtifactPart[];
}

/**
 * A peer's stream, normalized. The SDK's wire shapes (a `$case` union over
 * protobuf-derived types) stop here, so nothing above this file knows which
 * transport or protocol version answered.
 */
export type A2aEvent =
  | { kind: "task"; taskId: string; phase: A2aTaskPhase }
  | { kind: "status"; taskId: string; phase: A2aTaskPhase; text: string }
  | { kind: "artifact"; taskId: string; artifact: A2aArtifact }
  | { kind: "message"; taskId: string; text: string };

/** What to send a peer: text, optionally continuing an open Task. */
export interface A2aSend {
  text: string;
  taskId?: string;
  signal?: AbortSignal;
}

/** An attached A2A agent, as the rest of the server talks to one. */
export interface A2aPeer {
  readonly card: A2aCard;
  /** Sends text and yields the peer's reply as it arrives. */
  send(input: A2aSend): AsyncIterable<A2aEvent>;
  /** Asks the peer to cancel a Task. Success is not guaranteed by A2A. */
  cancel(taskId: string): Promise<void>;
}

/** Discovers a peer and opens a client to it. The seam tests replace. */
export type A2aConnect = (
  endpointUrl: string,
  headers: Record<string, string>,
) => Promise<A2aPeer>;

/** Whether a phase means the peer has stopped working on this turn. */
export function endsTurn(phase: A2aTaskPhase): boolean {
  return phase !== "working";
}

/**
 * Whether the Task outlived the turn, waiting on us. The one case where the
 * next thing we send belongs to the Task we already have rather than a new one.
 */
export function awaitsInput(phase: A2aTaskPhase): boolean {
  return phase === "input-required";
}

/**
 * A2A's task states, as phases. States absent here — submitted, working, and
 * whatever a future version adds — are "still working", which is the reading
 * that keeps an unknown state from settling a Run early.
 */
const PHASES: Partial<Record<TaskState, A2aTaskPhase>> = {
  [TaskState.TASK_STATE_COMPLETED]: "completed",
  [TaskState.TASK_STATE_CANCELED]: "canceled",
  [TaskState.TASK_STATE_FAILED]: "failed",
  [TaskState.TASK_STATE_REJECTED]: "failed",
  [TaskState.TASK_STATE_INPUT_REQUIRED]: "input-required",
  [TaskState.TASK_STATE_AUTH_REQUIRED]: "input-required",
};

/** Reads A2A's task state as a phase, defaulting to still working. */
function phaseOf(state: TaskState | undefined): A2aTaskPhase {
  if (state === undefined) return "working";
  return PHASES[state] ?? "working";
}

/** The readable content of one part, or nothing for bytes and links. */
function textOfPart(part: Part): string {
  const content = part.content;
  if (content?.$case === "text") return content.value;
  if (content?.$case === "data") return JSON.stringify(content.value);
  return "";
}

/** The readable content of a message, parts joined in order. */
function textOf(message: Message | undefined): string {
  if (!message) return "";
  return message.parts.map(textOfPart).join("");
}

/** The extension a part's content asks for, since only two kinds are written. */
function extensionFor(part: Part): string {
  return part.content?.$case === "data" ? ".json" : ".txt";
}

/** A filename for a part the peer did not name, kept unique within its set. */
function filenameFor(part: Part, artifact: Artifact, index: number): string {
  if (part.filename) return part.filename;
  const base = artifact.name || artifact.artifactId || "artifact";
  const suffix = artifact.parts.length > 1 ? `-${index + 1}` : "";
  return `${base}${suffix}${extensionFor(part)}`;
}

/** The writable body of a part: its bytes, or its text. */
function bodyOfPart(part: Part): string | Uint8Array {
  if (part.content?.$case === "raw") return part.content.value;
  return textOfPart(part);
}

/** Projects an A2A artifact onto files, dropping parts that are only links. */
function toArtifact(artifact: Artifact): A2aArtifact {
  const parts = artifact.parts
    .map((part, index) => ({
      filename: filenameFor(part, artifact, index),
      body: bodyOfPart(part),
      linked: part.content?.$case === "url",
    }))
    .filter((part) => !part.linked && part.body.length > 0);
  return {
    name: artifact.name || artifact.artifactId || "artifact",
    parts: parts.map(({ filename, body }) => ({ filename, body })),
  };
}

/** A whole Task, as the phase it is in. */
function taskEvent(task: Task): A2aEvent {
  return { kind: "task", taskId: task.id, phase: phaseOf(task.status?.state) };
}

/** A status change, carrying whatever the peer said along with it. */
function statusEvent(update: TaskStatusUpdateEvent): A2aEvent {
  return {
    kind: "status",
    taskId: update.taskId,
    phase: phaseOf(update.status?.state),
    text: textOf(update.status?.message),
  };
}

/** An artifact, unless the update carries none. */
function artifactEvent(update: TaskArtifactUpdateEvent): A2aEvent | undefined {
  if (!update.artifact) return undefined;
  return {
    kind: "artifact",
    taskId: update.taskId,
    artifact: toArtifact(update.artifact),
  };
}

/** A message the peer sent outside any status change. */
function messageEvent(message: Message): A2aEvent {
  return { kind: "message", taskId: message.taskId, text: textOf(message) };
}

/** Reads one stream response as an {@link A2aEvent}, or nothing. */
function toEvent(response: StreamResponse): A2aEvent | undefined {
  const payload = response.payload;
  if (!payload) return undefined;
  if (payload.$case === "task") return taskEvent(payload.value);
  if (payload.$case === "statusUpdate") return statusEvent(payload.value);
  if (payload.$case === "artifactUpdate") return artifactEvent(payload.value);
  return messageEvent(payload.value);
}

/** Builds the send request for one turn of text. */
function sendRequest(input: A2aSend): SendMessageRequest {
  return {
    tenant: "",
    message: {
      messageId: randomUUID(),
      contextId: "",
      taskId: input.taskId ?? "",
      role: Role.ROLE_USER,
      parts: [
        {
          content: { $case: "text", value: input.text },
          metadata: undefined,
          filename: "",
          mediaType: "text/plain",
        },
      ],
      metadata: undefined,
      extensions: [],
      referenceTaskIds: [],
    },
    configuration: undefined,
    metadata: undefined,
  };
}

/** `fetch` with the peer's credential attached, or plain `fetch` without one. */
function authorizedFetch(headers: Record<string, string>): typeof fetch {
  if (Object.keys(headers).length === 0) return fetch;
  return (input, init) =>
    fetch(input, {
      ...init,
      headers: {
        ...Object.fromEntries(new Headers(init?.headers)),
        ...headers,
      },
    });
}

/** Wraps an SDK client as an {@link A2aPeer}. */
function toPeer(client: Client, card: A2aCard): A2aPeer {
  return {
    card,
    async *send(input: A2aSend) {
      const stream = client.sendMessageStream(sendRequest(input), {
        signal: input.signal,
      });
      for await (const response of stream) {
        const event = toEvent(response);
        if (event) yield event;
      }
    },
    async cancel(taskId: string) {
      await client.cancelTask({ tenant: "", id: taskId, metadata: undefined });
    },
  };
}

/**
 * Fetches a peer's Agent Card and opens a client to it. Discovery is what
 * replaces spawn for A2A: the agent already exists as a service, so attaching
 * is reading its card and keeping the address.
 *
 * The card path is the SDK's default (`/.well-known/agent-card.json`), and the
 * transport is whichever of JSON-RPC or HTTP+JSON the card offers. Streaming is
 * the SDK's decision too — `sendMessageStream` falls back to a single blocking
 * send when the card does not declare it.
 */
export const discoverPeer: A2aConnect = async (endpointUrl, headers) => {
  const fetchImpl = authorizedFetch(headers);
  const factory = new ClientFactory(
    ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
      cardResolver: new DefaultAgentCardResolver({ fetchImpl }),
      transports: [
        new JsonRpcTransportFactory({ fetchImpl }),
        new RestTransportFactory({ fetchImpl }),
      ],
    }),
  );
  const client = await factory.createFromUrl(endpointUrl);
  const card = await client.getAgentCard();
  return toPeer(client, {
    name: card.name,
    description: card.description || undefined,
  });
};
