import { Tabs as TabsPrimitive } from "radix-ui";
import * as React from "react";

import { cn } from "./utils";

/**
 * Tabs — thin wrapper over Radix Tabs (shadcn-style), mirroring `collapsible.tsx`.
 *
 * Layout-friendly by default: `Tabs` (Root) and `TabsContent` are flex columns
 * that fill the available space, so a content panel can host a `grow`-ing column
 * (chat, scroll region, iframe) like a plain `BlockStack grow` would.
 *
 * When a `TabsContent` is rendered with `forceMount`, Radix keeps it mounted and
 * visible, so inactive panels are hidden here via `data-[state=inactive]:hidden`
 * (lets panels preserve scroll/streaming/iframe state across tab switches).
 */
function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex min-h-0 min-w-0 flex-1 flex-col", className)}
      {...props}
    />
  );
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "flex shrink-0 items-center gap-1 overflow-x-auto overflow-y-hidden border-b border-border px-2 subtle-scrollbar",
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-t-md border-b-2 border-transparent px-3 py-1.5 text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:border-primary data-[state=active]:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn(
        "min-h-0 min-w-0 flex-1 outline-none data-[state=active]:flex data-[state=active]:flex-col data-[state=inactive]:hidden",
        className,
      )}
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
