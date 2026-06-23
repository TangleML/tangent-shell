// One-shot handoff from the `/sessions/new` draft screen to the real session it
// navigates to. A module singleton because File objects can't ride in the URL.
export interface PendingNewSession {
  initialMessage?: string;
  files?: File[];
}

let pending: PendingNewSession | null = null;

export function setPendingNewSession(next: PendingNewSession): void {
  pending = next;
}

// Pure read (no clear), so it's safe in a useState initializer under StrictMode;
// pair with clearPendingNewSession in a mount effect to consume it once.
export function peekPendingNewSession(): PendingNewSession | null {
  return pending;
}

export function clearPendingNewSession(): void {
  pending = null;
}
