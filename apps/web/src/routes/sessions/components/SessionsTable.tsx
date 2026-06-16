import type { Session } from "@tangent/shared/contracts";

import { Button } from "@/shared/ui/button";
import { Icon } from "@/shared/ui/icon";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/patterns/table";
import { Text } from "@/shared/ui/typography";

interface SessionsTableProps {
  sessions: Session[];
  onOpen: (session: Session) => void;
}

/** Tabular list of sessions; each row opens its session. */
export function SessionsTable({ sessions, onOpen }: SessionsTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Bundle</TableHead>
          <TableHead>Action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sessions.map((session) => (
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
  // The whole row is the open affordance; the explicit "Open session" button
  // stops propagation so it doesn't double-trigger the row handler.
  const handleOpenClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    onOpen(session);
  };

  return (
    <TableRow onClick={() => onOpen(session)}>
      <TableCell>
        <Text weight="medium" truncate>
          {session.name}
        </Text>
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
        <Button variant="ghost" size="xs" onClick={handleOpenClick}>
          <Icon name="ArrowRight" size="xs" tone="subdued" />
          <Text tone="subdued">Open session</Text>
        </Button>
        <Button
          variant="ghost"
          size="xs"
          disabled
          aria-label="Delete session (coming soon)"
        >
          <Icon name="Trash" size="xs" tone="subdued" />
          <Text tone="subdued">Delete session</Text>
        </Button>
      </TableCell>
    </TableRow>
  );
}
