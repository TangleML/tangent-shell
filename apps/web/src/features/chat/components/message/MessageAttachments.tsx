import type { Attachment } from "@/features/chat/model/types";
import { apiUrl } from "@/shared/lib/basePath";
import { Icon } from "@/shared/ui/icon";
import { InlineStack } from "@/shared/ui/layout";
import { Pill } from "@/shared/ui/patterns/pill";

interface MessageAttachmentsProps {
  sessionId: string;
  attachments: Attachment[];
}

/** Renders the message's attached files as links to the session file API. */
export function MessageAttachments({
  sessionId,
  attachments,
}: MessageAttachmentsProps) {
  return (
    <InlineStack gap="1" wrap="wrap">
      {attachments.map((attachment) => (
        <a
          key={attachment.path}
          href={apiUrl(`/api/sessions/${sessionId}/files/${attachment.path}`)}
          target="_blank"
          rel="noreferrer"
        >
          <Pill tone="subdued" hoverable title={attachment.name}>
            <Icon name="File" size="xs" />
            {attachment.name}
          </Pill>
        </a>
      ))}
    </InlineStack>
  );
}
