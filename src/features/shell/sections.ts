export type Section = "todo" | "memo" | "assets" | "settings";

/** Top-level menu a pathname belongs to. */
export function sectionOf(pathname: string | null): Section | null {
  if (!pathname) return null;
  const first = pathname.split("/")[1] ?? "";
  if (first === "today" || first === "calendar" || first === "list") return "todo";
  if (first === "memo") return "memo";
  if (first === "assets") return "assets";
  if (first === "settings") return "settings";
  return null;
}

export const SECTION_TITLES: Record<Section, string> = {
  todo: "할 일",
  memo: "메모",
  assets: "자산",
  settings: "설정",
};
