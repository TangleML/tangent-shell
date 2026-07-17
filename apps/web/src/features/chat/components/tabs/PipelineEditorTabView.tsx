import {
  connectRemoteEnvironment,
  type RemoteEnvironmentClient,
} from "@tangent/remote-subagent";
import { Box } from "@tangent/ui-primitives/box";
import { Icon } from "@tangent/ui-primitives/icon";
import { BlockStack, InlineStack } from "@tangent/ui-primitives/layout";
import { Text } from "@tangent/ui-primitives/typography";
import { useEffect, useRef, useState } from "react";

import { env } from "@/shared/config/env";
import { apiUrl } from "@/shared/lib/basePath";
import { EmptyState } from "@/shared/ui/patterns/empty-state";
import { Toolbar } from "@/shared/ui/patterns/toolbar";

import { TangleEmbedClient } from "../../lib/tangleEmbedClient";

interface PipelineEditorTabViewProps {
  /** Session that owns this editor; binds the CSOM executor to it. */
  sessionId: string;
  /** Tab title (unused for now; the editor supplies its own pipeline name). */
  title: string;
}

/** Whether the browser tab is connected to the server as the CSOM executor. */
type RemoteStatus = "disabled" | "connecting" | "connected" | "error";

interface RemoteEnvConfig {
  enabled: boolean;
  token?: string;
}

/** Reads the `/remote-env` token the SPA uses to connect as a CSOM executor. */
async function fetchRemoteEnvConfig(): Promise<RemoteEnvConfig> {
  try {
    const res = await fetch(apiUrl("/api/remote-env/token"));
    if (!res.ok) return { enabled: false };
    return (await res.json()) as RemoteEnvConfig;
  } catch {
    return { enabled: false };
  }
}

/** Builds the embed URL with the origin gate and (optional) backend base. */
function buildEmbedUrl(base: string): string {
  const url = new URL("/embed/editor", base);
  url.searchParams.set("parentOrigin", window.location.origin);
  if (env.tangleBackendUrl) {
    url.searchParams.set("backendUrl", env.tangleBackendUrl);
  }
  return url.toString();
}

const STATUS_LABEL: Record<RemoteStatus, string> = {
  disabled: "Prime control off",
  connecting: "Connecting Prime...",
  connected: "Prime can edit live",
  error: "Prime control unavailable",
};

const STATUS_TONE: Record<RemoteStatus, "subdued" | "success" | "critical"> = {
  disabled: "subdued",
  connecting: "subdued",
  connected: "success",
  error: "critical",
};

/**
 * Full-screen tab that embeds the Tangle pipeline editor and lets Prime drive
 * it live. The iframe speaks the CSOM postMessage bridge; this tab also connects
 * to the server's `/remote-env` gateway as the session's CSOM executor, so each
 * CSOM tool Prime calls is relayed here and run against the editor.
 *
 * The parent is the source of truth for the embed, but here Prime edits the
 * in-memory spec directly through CSOM, so the graph updates in real time.
 */
export function PipelineEditorTabView({
  sessionId,
}: PipelineEditorTabViewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [remoteStatus, setRemoteStatus] = useState<RemoteStatus>("connecting");

  const embedBase = env.tangleEmbedUrl;

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !embedBase) return undefined;

    const embedOrigin = new URL(embedBase).origin;
    const client = new TangleEmbedClient(iframe, embedOrigin);
    client.init({
      parentOrigin: window.location.origin,
      backendUrl: env.tangleBackendUrl || undefined,
    });

    let remote: RemoteEnvironmentClient | undefined;
    let cancelled = false;

    void fetchRemoteEnvConfig().then((config) => {
      if (cancelled) return;
      if (!config.enabled || !config.token) {
        setRemoteStatus("disabled");
        return;
      }
      remote = connectRemoteEnvironment({
        url: window.location.origin,
        token: config.token,
        environmentId: `browser-csom:${sessionId}`,
        sessionId,
        handlers: {
          onCsomCall: (request) => client.call(request.method, ...request.args),
        },
      });
      remote.socket.on("connect", () => setRemoteStatus("connected"));
      remote.socket.on("disconnect", () => setRemoteStatus("connecting"));
      remote.socket.on("connect_error", () => setRemoteStatus("error"));
    });

    return () => {
      cancelled = true;
      remote?.disconnect();
      client.dispose();
    };
  }, [embedBase, sessionId]);

  if (!embedBase) {
    return (
      <Box padding="base">
        <EmptyState
          icon="Workflow"
          title="Pipeline editor not configured"
          description="Set VITE_TANGLE_EMBED_URL to the Tangle UI host that serves /embed/editor to enable this tab."
        />
      </Box>
    );
  }

  return (
    <BlockStack grow>
      <Toolbar chrome="light" align="end" aria-label="Pipeline editor status">
        <InlineStack gap="1" blockAlign="center" wrap="nowrap">
          <Icon
            name={remoteStatus === "connected" ? "Zap" : "ZapOff"}
            size="xs"
            tone={STATUS_TONE[remoteStatus]}
          />
          <Text size="xs" tone={STATUS_TONE[remoteStatus]}>
            {STATUS_LABEL[remoteStatus]}
          </Text>
        </InlineStack>
      </Toolbar>
      <div className="relative flex min-h-0 w-full flex-1">
        <iframe
          ref={iframeRef}
          src={buildEmbedUrl(embedBase)}
          title="Tangle pipeline editor"
          allow="clipboard-read; clipboard-write"
          className="absolute inset-0 h-full w-full border-0 bg-white"
        />
      </div>
    </BlockStack>
  );
}
