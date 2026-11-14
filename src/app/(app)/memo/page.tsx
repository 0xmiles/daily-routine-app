import type { Metadata } from "next";
import { Suspense } from "react";
import { MemoPage } from "@/features/memo/MemoPage";

export const metadata: Metadata = { title: "메모" };

/**
 * /memo — the memo files. `?id=<id>` opens one (old `?block=<id>` links too);
 * `?new` opens a new, empty memo (its first line, if any, comes from 빠른 추가 in memory).
 */
export default async function Page({ searchParams }: PageProps<"/memo">) {
  const { id, block } = await searchParams;
  const pick = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : null);
  return (
    <Suspense>
      <MemoPage initialId={pick(id) ?? pick(block)} />
    </Suspense>
  );
}
