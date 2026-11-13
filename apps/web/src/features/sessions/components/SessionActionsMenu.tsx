import type { Session } from "@tangent/shared/contracts";
import { Button } from "@tangent/ui-primitives/button";
import { Icon } from "@tangent/ui-primitives/icon";
import { BlockStack } from "@tangent/ui-primitives/layout";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@tangent/ui-primitives/popover";
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
import { IconButton } from "@/shared/ui/patterns/icon-button";

/** Which sub-view the actions popover currently shows. */
type View = "menu" | "rename" | "delete" | "bundle";

interface SessionActionsMenuProps {
  session: Session;
  /** Called after the session is deleted (e.g. to navigate away from it). */
  onDeleted?: (id: string) => void;
}

/**
 * Per-row actions for a session: rename, archive/unarchive, bundle
 * update/reinstall, and delete. Rendered
 * as a single controlled popover that switches between a menu, an inline rename
 * form, and an inline delete confirmation — keeping all three in one anchored
 * surface without a separate dialog primitive.
 */
export function SessionActionsMenu({
  session,
  onDeleted,
}: SessionActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("menu");

  const updateSession = useUpdateSession();
  const deleteSession = useDeleteSession();
  const reinstallBundle = useReinstallBundle();
  const bundleUpdate = useBundleUpdate(session);

  // Reset to the menu view whenever the popover (re)opens so a prior
  // rename/delete view never lingers.
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setView("menu");
      reinstallBundle.reset();
    }
  };

  const close = () => setOpen(false);

  const toggleArchive = () => {
    updateSession.mutate({
      id: session.id,
      input: { archived: !session.archived },
    });
    close();
  };

  const toggleAccess = () => {
    updateSession.mutate({
      id: session.id,
      input: {
        accessPolicy: session.accessPolicy === "open" ? "restricted" : "open",
      },
    });
    close();
  };

  const submitRename = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === session.name) {
      close();
      return;
    }
    updateSession.mutate(
      { id: session.id, input: { name: trimmed } },
      { onSuccess: close },
    );
  };

  const confirmReinstall = () => {
    reinstallBundle.mutate(
      { id: session.id, input: { version: bundleUpdate?.storedVersion } },
      { onSuccess: close },
    );
  };

  const confirmDelete = () => {
    deleteSession.mutate(session.id, {
      onSuccess: () => {
        close();
        onDeleted?.(session.id);
      },
    });
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <IconButton
          icon="EllipsisVertical"
          aria-label={`Actions for ${session.name}`}
          onClick={(event) => event.stopPropagation()}
        />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {view === "menu" ? (
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
        ) : null}
        {view === "rename" ? (
          <SessionRenameForm
            initialName={session.name}
            pending={updateSession.isPending}
            onSubmit={submitRename}
            onCancel={() => setView("menu")}
          />
        ) : null}
        {view === "bundle" && bundleUpdate ? (
          <SessionBundleReinstallConfirm
            installedVersion={bundleUpdate.installedVersion}
            storedVersion={bundleUpdate.storedVersion}
            pending={reinstallBundle.isPending}
            error={reinstallBundle.error?.message}
            onConfirm={confirmReinstall}
            onCancel={() => setView("menu")}
          />
        ) : null}
        {view === "delete" ? (
          <SessionDeleteConfirm
            pending={deleteSession.isPending}
            onConfirm={confirmDelete}
            onCancel={() => setView("menu")}
          />
        ) : null}
      </PopoverContent>
    </Popover>
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
