/**
 * Neutral (React-free, remote-dom-free) event contract types, shared by a
 * component's `*.contract.ts` and the worker/host helpers. Keeping them here lets
 * the contract stay importable from both sides without pulling in either runtime.
 */

/**
 * How a remote event's payload is decoded before the author's handler is called:
 *  - `none`    — handler invoked with no arguments (e.g. `press`).
 *  - `value`   — handler invoked with the event's string detail (e.g. `input`).
 *  - `checked` — handler invoked with the event's boolean detail (e.g. `change`).
 */
export type EventPayload = "none" | "value" | "checked";

/** A remote event mapped to the author-facing handler prop + payload decode. */
export interface RemoteEventDef {
  /** The author-facing handler prop (e.g. `onPress`, `onInput`). */
  handlerProp: string;
  /** How the event detail is decoded for the author's handler. */
  payload: EventPayload;
}

/** A component's events, keyed by remote event name (e.g. `press`). */
export type RemoteEvents = Record<string, RemoteEventDef>;
