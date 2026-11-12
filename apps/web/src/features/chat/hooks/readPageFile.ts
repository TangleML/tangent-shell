import {
  isPageFilePath,
  type PageBridgeMessage,
  type PageFetchResult,
} from "@tangent/shared/contracts";

import { apiFetch } from "@/shared/lib/apiFetch";

type PageFileRead = Pick<PageFetchResult, "status" | "contentType" | "body">;

async function fetchFile(path: string): Promise<PageFileRead> {
  try {
    const response = await apiFetch(path, { cache: "no-store" });
    return {
      status: response.status,
      contentType: response.headers.get("content-type") ?? undefined,
      body: await response.arrayBuffer(),
    };
  } catch {
    return { status: 0 };
  }
}

/**
 * Answers a page's `tangent:fetch`: reads the file with the app's credentials
 * when it is one of the page's own session files, and refuses anything else.
 */
export async function readPageFile(
  message: Extract<PageBridgeMessage, { type: "tangent:fetch" }>,
  sessionId: string,
  frame: HTMLIFrameElement,
): Promise<void> {
  const read: PageFileRead = isPageFilePath(sessionId, message.path)
    ? await fetchFile(message.path)
    : { status: 403 };
  const result: PageFetchResult = {
    type: "tangent:fetch:result",
    requestId: message.requestId,
    ...read,
  };
  frame.contentWindow?.postMessage(result, "*", read.body ? [read.body] : []);
}
