import type { Session } from "@tangent/shared/contracts";
import { Button } from "@tangent/ui-primitives/button";
import { Icon } from "@tangent/ui-primitives/icon";
import { BlockStack } from "@tangent/ui-primitives/layout";
import { useState } from "react";

import {
  SessionDeleteConfirm,
  SessionRenameForm,
} from "@/features/sessions/components/sessionActionForms";
import { useDeleteSession } from "@/features/sessions/hooks/useDeleteSession";
import { useUpdateSession } from "@/features/sessions/hooks/useUpdateSession";

/** Which sub-view the actions popover currently shows. */
type View = "menu" | "rename" | "delete";

interface SessionActionsMenuProps {
  session: Session;
  /** Closes the popover hosting this menu. */
  onClose: () => void;
  /** Called after the session is deleted (e.g. to navigate away from it). */
  onDeleted?: (id: string) => void;
}

/**
 * Per-row actions for a session: rename, archive/unarchive, and delete. Fills
 * the row's actions popover, switching between a menu, an inline rename form,
 * and an inline delete confirmation — keeping all three in one anchored surface
 * without a separate dialog primitive. The popover unmounts it on close, so each
 * open starts at the menu.
 */
export function SessionActionsMenu({
  session,
  onClose,
  onDeleted,
}: SessionActionsMenuProps) {
  const [view, setView] = useState<View>("menu");

  const updateSession = useUpdateSession();
  const deleteSession = useDeleteSession();

  const toggleArchive = () => {
    updateSession.mutate({
      id: session.id,
      input: { archived: !session.archived },
    });
    onClose();
  };

  const toggleAccess = () => {
    updateSession.mutate({
      id: session.id,
      input: {
        accessPolicy: session.accessPolicy === "open" ? "restricted" : "open",
      },
    });
    onClose();
  };

  const submitRename = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === session.name) {
      onClose();
      return;
    }
    updateSession.mutate(
      { id: session.id, input: { name: trimmed } },
      { onSuccess: onClose },
    );
  };

  // Awaited rather than a mutate callback, which React Query skips if closing
  // the popover unmounts this mid-request. A failure keeps the confirm open.
  const confirmDelete = async () => {
    try {
      await deleteSession.mutateAsync(session.id);
    } catch {
      return;
    }
    onClose();
    onDeleted?.(session.id);
  };

  if (view === "rename") {
    return (
      <SessionRenameForm
        initialName={session.name}
        pending={updateSession.isPending}
        onSubmit={submitRename}
        onCancel={() => setView("menu")}
      />
    );
  }

  if (view === "delete") {
    return (
      <SessionDeleteConfirm
        pending={deleteSession.isPending}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setView("menu")}
      />
    );
  }

  return (
    <MenuView
      archived={session.archived}
      accessPolicy={session.accessPolicy}
      onRename={() => setView("rename")}
      onToggleArchive={toggleArchive}
      onToggleAccess={toggleAccess}
      onDelete={() => setView("delete")}
    />
  );
}

interface MenuViewProps {
  archived: boolean;
  accessPolicy: Session["accessPolicy"];
  onRename: () => void;
  onToggleArchive: () => void;
  onToggleAccess: () => void;
  onDelete: () => void;
}

function MenuView({
  archived,
  accessPolicy,
  onRename,
  onToggleArchive,
  onToggleAccess,
  onDelete,
}: MenuViewProps) {
  const open = accessPolicy === "open";
  return (
    <BlockStack gap="1">
      <Button
        variant="ghost"
        size="sm"
        align="start"
        fullWidth
        onClick={onRename}
      >
        <Icon name="Pencil" size="xs" tone="subdued" />
        Rename
      </Button>
      <Button
        variant="ghost"
        size="sm"
        align="start"
        fullWidth
        onClick={onToggleAccess}
      >
        <Icon name={open ? "Lock" : "Users"} size="xs" tone="subdued" />
        {open ? "Make private" : "Make open"}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        align="start"
        fullWidth
        onClick={onToggleArchive}
      >
        <Icon
          name={archived ? "ArchiveRestore" : "Archive"}
          size="xs"
          tone="subdued"
        />
        {archived ? "Unarchive" : "Archive"}
      </Button>
      <Button
        variant="ghost"
        tone="critical"
        size="sm"
        align="start"
        fullWidth
        onClick={onDelete}
      >
        <Icon name="Trash" size="xs" />
        Delete
      </Button>
    </BlockStack>
  );
}
