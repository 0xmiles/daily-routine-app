import type { Metadata } from "next";
import { MemoPage } from "@/features/memo/MemoPage";

export const metadata: Metadata = { title: "메모" };

/** /memo[?block=<id>] — the memo pad; `block` scrolls to and focuses that block. */
export default async function Page({ searchParams }: PageProps<"/memo">) {
  const { block } = await searchParams;
  return <MemoPage focusBlockId={typeof block === "string" && block ? block : null} />;
}
