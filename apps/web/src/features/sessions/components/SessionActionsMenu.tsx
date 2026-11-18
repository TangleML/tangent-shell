import type { Session } from "@tangent/shared/contracts";
import { Button } from "@tangent/ui-primitives/button";
import { Icon } from "@tangent/ui-primitives/icon";
import { BlockStack } from "@tangent/ui-primitives/layout";
import { useState } from "react";

import {
  SessionBundleReinstallConfirm,
  SessionDeleteConfirm,
  SessionRenameForm,
} from "@/features/sessions/components/sessionActionForms";
import {
  type BundleUpdate,
  useBundleUpdate,
} from "@/features/sessions/hooks/useBundleUpdate";
import { useDeleteSession } from "@/features/sessions/hooks/useDeleteSession";
import { useReinstallBundle } from "@/features/sessions/hooks/useReinstallBundle";
import { useUpdateSession } from "@/features/sessions/hooks/useUpdateSession";

/** Which sub-view the actions popover currently shows. */
type View = "menu" | "rename" | "delete" | "bundle";

interface SessionActionsMenuProps {
  session: Session;
  /** Closes the popover hosting this menu. */
  onClose: () => void;
  /** Called after the session is deleted (e.g. to navigate away from it). */
  onDeleted?: (id: string) => void;
}

/**
 * Per-row actions for a session: rename, archive/unarchive, bundle
 * update/reinstall, and delete. Fills the row's actions popover, switching
 * between a menu and inline rename, bundle and delete views — keeping them in
 * one anchored surface without a separate dialog primitive. The popover unmounts it on close, so each
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
  const reinstallBundle = useReinstallBundle();
  const bundleUpdate = useBundleUpdate(session);

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

  // Awaited like delete: closing the popover unmounts this mid-request, and a
  // failure keeps the confirm open with the error shown.
  const confirmReinstall = async () => {
    try {
      await reinstallBundle.mutateAsync({
        id: session.id,
        input: { version: bundleUpdate?.storedVersion },
      });
    } catch {
      return;
    }
    onClose();
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

  if (view === "bundle" && bundleUpdate) {
    return (
      <SessionBundleReinstallConfirm
        installedVersion={bundleUpdate.installedVersion}
        storedVersion={bundleUpdate.storedVersion}
        pending={reinstallBundle.isPending}
        error={reinstallBundle.error?.message}
        onConfirm={() => void confirmReinstall()}
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
      bundleUpdate={bundleUpdate}
      onBundle={() => setView("bundle")}
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
  bundleUpdate: BundleUpdate | undefined;
  onBundle: () => void;
  onDelete: () => void;
}

function MenuView({
  archived,
  accessPolicy,
  onRename,
  onToggleArchive,
  onToggleAccess,
  bundleUpdate,
  onBundle,
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
      {bundleUpdate ? (
        <Button
          variant="ghost"
          size="sm"
          align="start"
          fullWidth
          onClick={onBundle}
        >
          <Icon name="RefreshCw" size="xs" tone="subdued" />
          {bundleUpdate.updateAvailable
            ? `Update bundle to v${bundleUpdate.storedVersion}`
            : "Reinstall bundle"}
        </Button>
      ) : null}
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
