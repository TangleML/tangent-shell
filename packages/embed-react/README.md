# @tangent/embed-react

Thin React 19 wrappers for embedding the Tangent UI in a third-party host app.

The UI itself ships as runtime-delivered custom elements (`embed.js`, served from
Tangent's origin). This package is only types and glue: it loads that module once,
renders the elements, forwards rich values as element _properties_, and turns the
elements' `CustomEvent`s into `on*` props. Because it holds no UI, Tangent can ship
UI changes without the host redeploying — the host redeploys only when the
prop/event contract changes.

## Requirements

- React 19 (unknown props on custom elements are assigned as properties).
- The host and Tangent may be different origins. CORS and bearer auth on the
  Tangent server are required for cross-origin use (see the deploy notes).

## Install

```bash
pnpm add @tangent/embed-react
```

## Quickstart

Wrap your app in `TangentProvider`, start a session, and render `Chat`.

```tsx
import { TangentProvider, Chat, useTangent } from "@tangent/embed-react";
import { useState } from "react";

function Embed() {
  const { newSession } = useTangent();
  const [sessionId, setSessionId] = useState<string | null>(null);

  async function start() {
    const { sessionId } = await newSession(
      "Draft a pipeline that ingests orders and flags anomalies.",
      "tangle-oss", // agent bundle id
      { model: "claude-sonnet", name: "Anomaly pipeline" },
    );
    setSessionId(sessionId);
  }

  return sessionId ? (
    <Chat
      sessionId={sessionId}
      style={{ height: "100%" }}
      onOpenArtifact={(url, title) => openInHostTab(url, title)}
      onSendPrompt={(content) => console.log("user sent:", content)}
    />
  ) : (
    <button onClick={start}>New session</button>
  );
}

export function App() {
  return (
    <TangentProvider
      baseUrl="https://tangent.example"
      getToken={() => auth.getAccessToken()}
      colorScheme="system"
    >
      <Embed />
    </TangentProvider>
  );
}
```

## API

### `<TangentProvider>`

Loads the runtime once and owns the shared configuration.

| Prop          | Type                                        | Notes                                                             |
| ------------- | ------------------------------------------- | ----------------------------------------------------------------- |
| `baseUrl`     | `string`                                    | Tangent origin. API + socket + channel URL derive from this.      |
| `getToken`    | `() => string \| undefined \| Promise<...>` | Bearer token for API/socket auth. Held in memory, never in URLs.  |
| `colorScheme` | `"light" \| "dark" \| "system"`             | Defaults to `light`.                                              |
| `tokens`      | `Record<string, string>`                    | Unstable escape hatch for one-off token overrides.                |
| `socketUrl`   | `string`                                    | Override the Socket.IO origin (defaults to the API origin).       |
| `socketPath`  | `string`                                    | Override the Socket.IO path (defaults to `/socket.io`).           |
| `channelUrl`  | `string`                                    | Override the runtime URL (defaults to `${baseUrl}/embed/v1/...`). |
| `instance`    | `string`                                    | Disambiguate when a page mounts more than one provider.           |

### `useTangent()`

Returns `{ newSession }`.

```ts
newSession(
  prompt: string,
  bundleId: string,
  options?: {
    name?: string;
    model?: string;
    thinkingDepth?: string;
    delivery?: "auto" | "steer" | "followUp";
    attachments?: unknown[];
  },
): Promise<{ sessionId: string }>;
```

Creates a session from the bundle and queues `prompt`; the chat sends it once it
joins, so it never races the agent. Render `<Chat sessionId={...} />` with the
returned id.

### `<Chat>`

| Prop                 | Type                   | Notes                                                     |
| -------------------- | ---------------------- | --------------------------------------------------------- |
| `sessionId`          | `string`               | The session to render.                                    |
| `agentId`            | `string`               | Render this agent's thread instead of Prime.              |
| `initialPrompt`      | `string`               | Sent once the session joins (for a host-created session). |
| `onOpenArtifact`     | `(url, title) => void` | The host decides how to open the resource.                |
| `onSendPrompt`       | `(content) => void`    | Fired when the user submits a prompt.                     |
| `onError`            | `(message) => void`    | Fired on a surfaced runtime error.                        |
| `className`, `style` | —                      | Forwarded to the element; size it with `height`.          |

### `<SessionList>`

Renders the session list. It fetches its own sessions; wire `onSelect` (and
optionally `onDeleted`) to react to the user, and pass `selectedId` to highlight
the active row.

| Prop                 | Type           | Notes                                                     |
| -------------------- | -------------- | --------------------------------------------------------- |
| `onSelect`           | `(id) => void` | A row was clicked. The host decides what selecting means. |
| `selectedId`         | `string`       | Highlighted row; scrolled into view when set.             |
| `onDeleted`          | `(id) => void` | A session was deleted from its row menu.                  |
| `instance`           | `string`       | Disambiguate when a page mounts more than one provider.   |
| `className`, `style` | —              | Forwarded to the element; size it with `height`.          |

### `<AgentList>`

Renders Prime and the live sub-agent roster for a session. Wire `onOpen` to
place a `<Chat agentId={agent.id}>` (or any host chrome); dismissing a killed
sub-agent surfaces through `onRemove`.

```tsx
<AgentList
  sessionId={sessionId}
  selectedId={openAgentId}
  onOpen={(agent) => setOpenAgentId(agent.id)}
/>;
{
  openAgentId ? <Chat sessionId={sessionId} agentId={openAgentId} /> : null;
}
```

| Prop                 | Type              | Notes                                                     |
| -------------------- | ----------------- | --------------------------------------------------------- |
| `sessionId`          | `string`          | The session whose agents to render.                       |
| `onOpen`             | `(agent) => void` | A card was clicked. `agent.conversationId` is the thread. |
| `selectedId`         | `string`          | Highlighted row (Prime or a sub-agent id).                |
| `onRemove`           | `(id) => void`    | A killed sub-agent was dismissed from the list.           |
| `instance`           | `string`          | Disambiguate multiple providers.                          |
| `className`, `style` | —                 | Forwarded; size it with `height`.                         |

### `<AssetList>`

Renders pinned pages, files, and triggers for a session. Wire `onOpen` to place
an `<ArtifactViewer>` for a `page`; unpin (and trigger toggle/delete) stay
inside the element, with `onUnpin` so the host can close a matching viewer.

```tsx
<AssetList
  sessionId={sessionId}
  onOpen={(asset) => {
    if (asset.kind === "page") openViewer(asset.url, asset.title);
  }}
/>
```

| Prop                 | Type              | Notes                                             |
| -------------------- | ----------------- | ------------------------------------------------- |
| `sessionId`          | `string`          | The session whose assets to render.               |
| `onOpen`             | `(asset) => void` | A card was clicked. Discriminate on `asset.kind`. |
| `selectedId`         | `string`          | Highlighted row (artifact URL or trigger id).     |
| `onUnpin`            | `(path) => void`  | An artifact was unpinned.                         |
| `instance`           | `string`          | Disambiguate multiple providers.                  |
| `className`, `style` | —                 | Forwarded; size it with `height`.                 |

### `<ArtifactViewer>`

Renders an opened artifact (markdown, PDF, images, HTML). Point it at a resolved
`url` — for example the one handed to `<Chat onOpenArtifact>`. A submitted review
surfaces through `onSendPrompt`, which you typically forward to a `<Chat>`.

| Prop                 | Type                              | Notes                                    |
| -------------------- | --------------------------------- | ---------------------------------------- |
| `sessionId`          | `string`                          | Session that owns the artifact.          |
| `url`                | `string`                          | Resolved artifact URL.                   |
| `title`              | `string`                          | Human-readable title.                    |
| `onSendPrompt`       | `(content, attachments?) => void` | Review submitted; feed it to a `<Chat>`. |
| `instance`           | `string`                          | Disambiguate multiple providers.         |
| `className`, `style` | —                                 | Forwarded; size it with `height`.        |

### `<BundledUISlot>`

Renders a sandboxed bundle-UI component in a Web Worker (remote-dom). Prompts and
collapse requests from the component surface via callbacks.

| Prop                 | Type                      | Notes                                       |
| -------------------- | ------------------------- | ------------------------------------------- |
| `moduleUrl`          | `string`                  | URL of the compiled component JS.           |
| `kind`               | `"message" \| "panel"`    | Which surface the component renders on.     |
| `props`              | `Record<string, unknown>` | JSON props for a `message` component.       |
| `stateNamespace`     | `string`                  | localStorage namespace for persisted state. |
| `onSendPrompt`       | `(text) => void`          | A `panel` component composed a prompt.      |
| `onCollapse`         | `() => void`              | The component asked to collapse.            |
| `instance`           | `string`                  | Disambiguate multiple providers.            |
| `className`, `style` | —                         | Forwarded to the element.                   |

## Versioning

The runtime reports a protocol version at registration; this package declares the
range it supports and warns on mismatch rather than failing. A breaking contract
change bumps the served channel to `/embed/v2/` and both serve in parallel while
hosts migrate.
