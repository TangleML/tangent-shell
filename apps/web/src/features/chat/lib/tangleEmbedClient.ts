/**
 * Promise-based RPC client for the Tangle embedded editor's CSOM postMessage
 * bridge (see the embed's `csomBridgeProtocol.ts`). The parent (this app) waits
 * for `tangle-csom:ready`, pushes `init` config, and issues `call`s whose
 * results resolve on the matching `tangle-csom:result`. `event`s (e.g.
 * `specChanged`) are surfaced through `onEvent`.
 *
 * Messages before `ready` are queued and flushed on ready, except `init`, which
 * may be sent immediately so the embed has its config as early as possible.
 */

const CSOM_MESSAGE = {
  ready: "tangle-csom:ready",
  init: "tangle-csom:init",
  call: "tangle-csom:call",
  result: "tangle-csom:result",
  event: "tangle-csom:event",
} as const;

/** Config pushed to the embed's `init` handshake. */
export interface TangleEmbedInit {
  parentOrigin?: string;
  backendUrl?: string;
  authToken?: string;
  spec?: string;
  pipeline?: { name: string; fileId?: string };
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

interface CsomResultMessage {
  type: typeof CSOM_MESSAGE.result;
  id: string;
  ok: boolean;
  value?: unknown;
  error?: string;
}

interface CsomEventMessage {
  type: typeof CSOM_MESSAGE.event;
  event: string;
  payload?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export class TangleEmbedClient {
  private readonly pending = new Map<string, Pending>();
  private readonly queue: object[] = [];
  private ready = false;
  private disposed = false;

  private readonly iframe: HTMLIFrameElement;
  /** Origin of the Tangle UI host; gates inbound messages and targets posts. */
  private readonly embedOrigin: string;
  private readonly onEvent?: (event: string, payload: unknown) => void;

  constructor(
    iframe: HTMLIFrameElement,
    embedOrigin: string,
    onEvent?: (event: string, payload: unknown) => void,
  ) {
    this.iframe = iframe;
    this.embedOrigin = embedOrigin;
    this.onEvent = onEvent;
    window.addEventListener("message", this.handleMessage);
  }

  /** Supplies/refreshes embed config. Safe to call before `ready`. */
  init(config: TangleEmbedInit): void {
    this.post({ type: CSOM_MESSAGE.init, config }, true);
  }

  /** Invokes a CSOM method by name with positional args; resolves its result. */
  call<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
    const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.post({ type: CSOM_MESSAGE.call, id, method, args });
    });
  }

  /** Tears down listeners and rejects any in-flight calls. */
  dispose(): void {
    this.disposed = true;
    window.removeEventListener("message", this.handleMessage);
    for (const pending of this.pending.values()) {
      pending.reject(new Error("Pipeline editor closed"));
    }
    this.pending.clear();
  }

  private handleMessage = (event: MessageEvent): void => {
    if (this.disposed || event.origin !== this.embedOrigin) return;
    const msg = event.data;
    if (!isRecord(msg) || typeof msg.type !== "string") return;

    if (msg.type === CSOM_MESSAGE.ready) {
      this.flushQueue();
      return;
    }
    if (msg.type === CSOM_MESSAGE.result) {
      this.resolveResult(msg as unknown as CsomResultMessage);
      return;
    }
    if (msg.type === CSOM_MESSAGE.event) {
      const evt = msg as unknown as CsomEventMessage;
      this.onEvent?.(evt.event, evt.payload);
    }
  };

  private flushQueue(): void {
    this.ready = true;
    const buffered = this.queue.splice(0, this.queue.length);
    for (const message of buffered) this.postNow(message);
  }

  private resolveResult(msg: CsomResultMessage): void {
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    this.pending.delete(msg.id);
    if (msg.ok) {
      pending.resolve(msg.value);
      return;
    }
    pending.reject(new Error(msg.error ?? "CSOM call failed"));
  }

  /** Posts a message, buffering until `ready` unless `immediate` is set. */
  private post(message: object, immediate = false): void {
    if (!this.ready && !immediate) {
      this.queue.push(message);
      return;
    }
    this.postNow(message);
  }

  private postNow(message: object): void {
    this.iframe.contentWindow?.postMessage(message, this.embedOrigin);
  }
}
