import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AssetsPage } from "@/features/assets/AssetsPage";
import { FEATURES } from "@/shared/features";

export const metadata: Metadata = { title: "자산" };

/** 자산 is turned off (src/shared/features.ts): old links and bookmarks land on 오늘. */
export default function Page() {
  if (!FEATURES.assets) redirect("/today");
  return <AssetsPage />;
}
