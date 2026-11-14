import type { Metadata } from "next";
import { TodoSegment } from "@/features/shell/TodoSegment";
import { TodoListPage } from "@/features/todos/TodoListPage";

export const metadata: Metadata = { title: "할 일 목록" };

export default function ListPage() {
  return (
    <>
      <TodoSegment active="list" />
      <TodoListPage />
    </>
  );
}
