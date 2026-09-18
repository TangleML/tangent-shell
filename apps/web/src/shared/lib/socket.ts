import { io, type Socket } from "socket.io-client";

import { getAuthToken, socketPath, socketUrl } from "@/shared/lib/basePath";

/**
 * Creates a Socket.IO client honouring the embed API configuration. In the
 * standalone SPA this connects same-origin with the mount-prefixed path (Vite
 * proxies `/socket.io` in dev); embedded on a host page it targets Tangent's
 * origin and attaches the bearer token over the handshake.
 */
export function createSocket(): Socket {
  const options = {
    autoConnect: true,
    path: socketPath(),
    auth: (cb: (data: Record<string, unknown>) => void) => {
      void Promise.resolve(getAuthToken()).then((token) =>
        cb(token ? { token } : {}),
      );
    },
  };

  const url = socketUrl();
  return url ? io(url, options) : io(options);
}
