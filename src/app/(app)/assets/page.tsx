import type { Metadata } from "next";
import { AssetsPage } from "@/features/assets/AssetsPage";

export const metadata: Metadata = { title: "자산" };

export default function Page() {
  return <AssetsPage />;
}
