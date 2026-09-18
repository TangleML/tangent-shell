import type { Session, UserIdentity } from "@tangent/shared/contracts";
import { InlineStack } from "@tangent/ui-primitives/layout";
import { Text } from "@tangent/ui-primitives/typography";

import { SessionActivityCell } from "@/features/sessions/components/SessionActivityCell";
import { SessionRowActions } from "@/features/sessions/components/SessionRowActions";
import { SessionStatusIndicator } from "@/features/sessions/components/SessionStatusIndicator";
import { HoverReveal } from "@/shared/ui/patterns/hover-reveal";
import { Pill } from "@/shared/ui/patterns/pill";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/patterns/table";

function getOwnerLabel(user: UserIdentity): string {
  const fullName = `${user.first_name} ${user.last_name}`.trim();
  return fullName || user.email;
}

interface SessionsTableProps {
  sessions: Session[];
  onOpen: (session: Session) => void;
}

/** Tabular list of sessions; each row opens its session. */
export function SessionsTable({ sessions, onOpen }: SessionsTableProps) {
  const sortedSessions = [...sessions].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Activity</TableHead>
          <TableHead>Bundle</TableHead>
          <TableHead>Owner</TableHead>
          <TableHead>Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortedSessions.map((session) => (
          <SessionRow key={session.id} session={session} onOpen={onOpen} />
        ))}
      </TableBody>
    </Table>
  );
}

interface SessionRowProps {
  session: Session;
  onOpen: (session: Session) => void;
}

function SessionRow({ session, onOpen }: SessionRowProps) {
  return (
    // `group` lets the hover-revealed row actions appear on hover/focus.
    <TableRow className="group" onClick={() => onOpen(session)}>
      <TableCell>
        <InlineStack gap="2" blockAlign="center">
          <Text weight="medium" truncate>
            {session.name}
          </Text>
          {session.archived ? (
            <Pill size="xs" tone="subdued">
              Archived
            </Pill>
          ) : null}
        </InlineStack>
      </TableCell>
      <TableCell>
        <SessionStatusIndicator sessionId={session.id} />
      </TableCell>
      <TableCell>
        <SessionActivityCell session={session} />
      </TableCell>
      <TableCell>
        {session.config ? (
          <Text size="sm" tone="subdued">
            {session.config.name} v{session.config.version}
          </Text>
        ) : (
          <Text size="sm" tone="subdued">
            &mdash;
          </Text>
        )}
      </TableCell>
      <TableCell>
        {session.user ? (
          <Text size="sm" tone="subdued">
            {getOwnerLabel(session.user)}
          </Text>
        ) : (
          <Text size="sm" tone="subdued">
            &mdash;
          </Text>
        )}
      </TableCell>
      <TableCell>
        <HoverReveal>
          <SessionRowActions session={session} />
        </HoverReveal>
      </TableCell>
    </TableRow>
  );
}
