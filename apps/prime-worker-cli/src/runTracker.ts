import type { SessionRunStatus } from "@tangent/shared/contracts.ts";

const NOT_ACCEPTED_MS = 30_000;
// Prime can start another run right after one ends (a sub-agent reports back).
const SETTLE_MS = 1_500;
// How often to look again while a helper outside the Shell is still working.
const OPEN_WORK_POLL_MS = 5_000;
const CONNECTION_LOST_WARNING =
  "(Warning: the connection to the Shell was lost during this run, so Prime's reply may be missing or incomplete. Check the session in the web UI.)";

/**
 * Decides when Prime's run starts and ends. One run can span several messages,
 * so a message ending is not the run ending; the session's run status is. A
 * fresh Prime reports `active` before `busy`, so a run only ends on a non-busy
 * status after `busy` was seen. The Shell stores a finished message before
 * broadcasting it, so the status can arrive first: the end waits for
 * streaming messages and for a quiet period in which no new `busy` arrives.
 */
/** Whether work Prime handed off is still open, such as an attached agent's run. */
export type OpenWorkCheck = () => Promise<boolean>;

export class RunTracker {
  private running = false;
  private sawBusy = false;
  private settled = false;
  // Bumped on every settle change, so a check that resolves late is ignored.
  private settleGeneration = 0;
  private connectionLost = false;
  private lastStatus: SessionRunStatus = "idle";
  private watchdog: NodeJS.Timeout | undefined;
  private settleTimer: NodeJS.Timeout | undefined;
  private readonly streaming = new Set<string>();
  private messages: string[] = [];

  private readonly onRunStart: () => void;
  private readonly onRunEnd: (reply: string) => void;
  private readonly hasOpenWork: OpenWorkCheck | undefined;

  /**
   * `onRunEnd` gets every Prime message of the run, in order. The session's
   * status only covers the Shell's own agents, so `hasOpenWork` keeps the run
   * going while a helper outside it is still working.
   */
  constructor(
    onRunStart: () => void,
    onRunEnd: (reply: string) => void,
    hasOpenWork?: OpenWorkCheck,
  ) {
    this.onRunStart = onRunStart;
    this.onRunEnd = onRunEnd;
    this.hasOpenWork = hasOpenWork;
  }

  get isRunning(): boolean {
    return this.running;
  }

  messageSent(): void {
    this.start();
    if (this.sawBusy) return;
    // A rejected message never makes Prime busy; without this the run hangs.
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(
      () => this.failed("the message was not accepted"),
      NOT_ACCEPTED_MS,
    );
  }

  status(status: SessionRunStatus): void {
    this.lastStatus = status;
    // Any non-idle status clears it: a fresh Prime reports `active` before
    // `busy`, and a false "not accepted" is worse than a late one.
    if (status !== "idle") clearTimeout(this.watchdog);
    if (status === "busy") {
      this.start();
      this.sawBusy = true;
      this.cancelSettle();
    } else if (this.sawBusy) {
      this.cancelSettle();
      this.armSettle(SETTLE_MS);
    }
  }

  primeMessageStarted(messageId: string): void {
    this.streaming.add(messageId);
  }

  primeMessageEnded(messageId: string, content: string): void {
    this.streaming.delete(messageId);
    const text = content.trim();
    if (text) this.messages.push(text);
    this.endWhenSettled();
  }

  /** An error for an unknown message belongs to another agent: ignored. */
  failed(message: string, messageId?: string): void {
    if (messageId && !this.streaming.has(messageId)) return;
    this.messages.push(`Prime error: ${message}`);
    this.end();
  }

  /** Messages in flight when the socket drops will never finish. */
  disconnected(): void {
    this.streaming.clear();
    if (this.running) this.connectionLost = true;
  }

  private start(): void {
    if (this.running) return;
    this.running = true;
    // The Shell only announces status changes, so a busy session sends no `busy`.
    this.sawBusy = this.lastStatus === "busy";
    this.connectionLost = false;
    this.streaming.clear();
    this.messages = [];
    this.onRunStart();
  }

  private armSettle(delayMs: number): void {
    const generation = this.settleGeneration;
    this.settleTimer = setTimeout(
      () => this.settleUnlessOpen(generation),
      delayMs,
    );
  }

  private settleUnlessOpen(generation: number): void {
    if (!this.hasOpenWork) return this.markSettled();
    void this.hasOpenWork()
      .catch(() => false)
      .then((open) => {
        if (generation !== this.settleGeneration || !this.running) return;
        if (open) this.armSettle(OPEN_WORK_POLL_MS);
        else this.markSettled();
      });
  }

  private markSettled(): void {
    this.settled = true;
    this.endWhenSettled();
  }

  private cancelSettle(): void {
    clearTimeout(this.settleTimer);
    this.settled = false;
    this.settleGeneration += 1;
  }

  private endWhenSettled(): void {
    if (this.settled && this.streaming.size === 0) this.end();
  }

  private end(): void {
    if (!this.running) return;
    clearTimeout(this.watchdog);
    this.cancelSettle();
    this.running = false;
    const reply = this.messages.join("\n\n");
    this.onRunEnd(
      this.connectionLost
        ? `${CONNECTION_LOST_WARNING}\n\n${reply}`.trim()
        : reply,
    );
  }
}
