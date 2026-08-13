import {
  type ParticipantPresencePayload,
  SocketEvents,
} from "@tangent/shared/contracts.ts";
import type { Server } from "socket.io";

import { roomFor } from "./rooms.ts";

/** Broadcasts a Participant's presence transition to its session room. */
export function createParticipantPresenceEmitter(
  io: Server,
): (payload: ParticipantPresencePayload) => void {
  return (payload) => {
    io.to(roomFor(payload.sessionId)).emit(
      SocketEvents.ParticipantPresence,
      payload,
    );
  };
}

/**
 * Refcounts a Participant's live sockets so presence tracks the person, not one
 * tab: arriving on the first socket and departing on the last are the only two
 * transitions that matter. A person with two tabs open stays present until both
 * close, which is what makes `detached` mean "gone" rather than "switched tab".
 */
export class PresenceTracker {
  private readonly counts = new Map<string, number>();

  private key(sessionId: string, participantId: string): string {
    return `${sessionId}\u0000${participantId}`;
  }

  /** Registers a socket for a participant; true when it is their first. */
  arrive(sessionId: string, participantId: string): boolean {
    const key = this.key(sessionId, participantId);
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    return next === 1;
  }

  /** Deregisters a socket for a participant; true when it was their last. */
  depart(sessionId: string, participantId: string): boolean {
    const key = this.key(sessionId, participantId);
    const next = (this.counts.get(key) ?? 0) - 1;
    if (next <= 0) {
      this.counts.delete(key);
      return true;
    }
    this.counts.set(key, next);
    return false;
  }
}
