export const RAIL_TABS = ["workspace", "runtime", "extensions", "logs"] as const;

export type RailTab = (typeof RAIL_TABS)[number];

export type RailTabMove = "next" | "previous" | "first" | "last";

export function railTabAfter(current: RailTab, move: RailTabMove): RailTab {
  if (move === "first") {
    return RAIL_TABS[0];
  }
  if (move === "last") {
    return RAIL_TABS[RAIL_TABS.length - 1] ?? "logs";
  }
  const index = RAIL_TABS.indexOf(current);
  const safeIndex = index === -1 ? 0 : index;
  const offset = move === "next" ? 1 : -1;
  return RAIL_TABS[(safeIndex + offset + RAIL_TABS.length) % RAIL_TABS.length] ?? "runtime";
}
