/** Ordered window ids per dock column; array order is the default stack order (first visit only). */
interface PresetDockAreas {
  left: string[];
  right: string[];
}

export interface ViewPreset {
  label: string;
  description: string;
  visible: Set<string>;
  /** Default dock columns: ids per side, order matters for first-visit layout seeding. */
  dockAreas?: PresetDockAreas;
}

export const DEFAULT_DOCK_AREAS: PresetDockAreas = {
  left: [],
  right: [],
};

/** Target dock side for each window id listed in a preset's `dockAreas`. Right wins if listed on both. */
export function dockSideByWindowId(
  areas: PresetDockAreas,
): Map<string, "left" | "right"> {
  const map = new Map<string, "left" | "right">();
  for (const id of areas.left) {
    map.set(id, "left");
  }
  for (const id of areas.right) {
    map.set(id, "right");
  }
  return map;
}

export const DEFAULT_VIEW_PRESET: ViewPreset = {
  label: "Default",
  description: "No windows visible by default",
  visible: new Set<string>(),
  dockAreas: DEFAULT_DOCK_AREAS,
};
