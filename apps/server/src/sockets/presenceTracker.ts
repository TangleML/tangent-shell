import {
  type ParticipantPresencePayload,
  type Presence,
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

function presenceOf(tabs: ReadonlyMap<string, boolean>): Presence {
  if (tabs.size === 0) return "detached";
  return [...tabs.values()].includes(true) ? "connected" : "away";
}

export class PresenceTracker {
  private readonly tabsByPerson = new Map<string, Map<string, boolean>>();

  /** Returns a transition only when the person's aggregate presence changes. */
  update(
    sessionId: string,
    participantId: string,
    socketId: string,
    focused: boolean | null,
  ): Presence | undefined {
    const key = `${sessionId}\u0000${participantId}`;
    const tabs = this.tabsByPerson.get(key) ?? new Map<string, boolean>();
    const previous = presenceOf(tabs);
    if (focused === null) tabs.delete(socketId);
    else tabs.set(socketId, focused);
    if (tabs.size) this.tabsByPerson.set(key, tabs);
    else this.tabsByPerson.delete(key);
    const next = presenceOf(tabs);
    return next === previous ? undefined : next;
  }
}
