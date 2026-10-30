# Local Agents — Security

A local agent is a live window into its owner's machine: the sub-agents it hosts
edit files and run the terminal in the owner's workspace. Who is allowed to
drive one is therefore an authorization decision, not just a routing one.

## Owner-only direct messages

**Rule.** Only the person who connected a local agent may send directed messages
to the sub-agents it hosts. Everyone else is refused, and nothing reaches the
machine.

**How ownership is known.** A local agent connects with a scoped token minted
with `sub: <email>` (see `handleMintRemoteEnvToken` in
[../apps/server/src/routes/embed.ts](../apps/server/src/routes/embed.ts)). The
gateway stores that email as the hosting environment's `sub`
([../apps/server/src/remote/remoteEnvironmentGateway.ts](../apps/server/src/remote/remoteEnvironmentGateway.ts)).
A human chat message carries its sender as `audienceParticipantId`, which is the
sender's email (`humanAuthor().id`, falling back to `local-user` when none is
present).

**Where it is enforced.** Every directed message to a remote sub-agent funnels
through `RemoteEnvConnector.deliver`
([../apps/server/src/connectors/remoteEnvConnector.ts](../apps/server/src/connectors/remoteEnvConnector.ts)),
which consults `RemoteEnvironmentGateway.canDirectSubagent(sessionId, agentId,
audienceParticipantId)` before sending. The gate admits the message only when
the sender matches the hosting environment's owner, and refuses otherwise with
an in-thread notice so the sender sees why.

Three cases are intentionally **not** owner-gated:

- **Agent-originated deliveries** (no `audienceParticipantId`) — Prime's own
  orchestration of the sub-agents it spawned. See the remaining gap below.
- **Unscoped dev hosts** (no `sub`) — the shared-secret fallback used in local
  development, which has no owner to enforce.
- **Detached sub-agents** (hosting environment gone) — deferred to
  `sendToAgent`, which reports that the environment is disconnected.

Spawning is already owner-safe: a sub-agent is spawned on the prompting person's
own host (audience routing in `spawnSubagent` / `toolEnvironments`), so a user
cannot land a sub-agent on someone else's machine in the first place.

## Remaining gap: Prime-mediated relays

The owner gate covers messages a human sends **directly** to a sub-agent. It
does not cover messages Prime relays on a human's behalf.

When user B prompts Prime in a shared session, Prime can send a directed message
to a sub-agent that user A owns (one spawned earlier on A's machine). That relay
is agent-originated — it carries no `audienceParticipantId` — so
`canDirectSubagent` lets it through. In effect, B can indirectly drive A's local
agent by asking Prime to.

This is out of scope for the current change and is left as a follow-up because
closing it touches multi-user orchestration semantics.

### Potential approach

Carry the driving human through Prime's relays and extend the same gate:

1. When Prime relays to a sub-agent, stamp the run's audience — the human who
   woke Prime, already tracked via `runs.audienceFor(sessionId, agentId)` — onto
   the delivery (e.g. as `audienceParticipantId`, or a dedicated field so a
   genuine human sender is not conflated with the relayer).
2. Extend `canDirectSubagent` to compare that driving human against the hosting
   environment's `sub`, refusing when they differ.

Tradeoff to weigh: in a shared session this stops one participant from steering
another participant's local agent through Prime at all. That is the safe
default, but it narrows what collaborative sessions can do, so it deserves an
explicit product decision before shipping.
